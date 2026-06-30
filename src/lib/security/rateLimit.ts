// ─────────────────────────────────────────────────────────────────────────
// Rate limiting — abuse / brute-force protection for sensitive endpoints.
//
// This is a fixed-window counter keyed by (bucket, client). It is intentionally
// IN-MEMORY and therefore PER-INSTANCE: it stops credential-stuffing and runaway
// clients against a single server with zero infrastructure. At horizontal scale
// the same `checkRateLimit` contract is meant to be re-backed by Redis/Upstash
// (swap the store; callers don't change) — the limiter is the chokepoint, the
// store is an implementation detail.
//
// Design choices:
//   • Fail OPEN on internal error — a limiter bug must never lock every user out.
//   • A periodic sweep evicts stale windows so the map can't grow unbounded.
//   • Returns the standard signals (limit, remaining, resetMs, retryAfterSec) so
//     handlers can emit RFC-compliant 429 + Retry-After + X-RateLimit-* headers.
// ─────────────────────────────────────────────────────────────────────────

export interface RateLimitRule {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Seconds the client should wait before retrying (only meaningful when !ok). */
  retryAfterSec: number;
}

interface Window {
  count: number;
  resetAt: number;
}

// Module-global store so it survives across requests within an instance. Keyed
// by `${bucket}:${client}`.
const store = new Map<string, Window>();

// Bound memory: opportunistically evict expired windows. Cheap and amortized —
// runs at most once per SWEEP_INTERVAL_MS regardless of traffic.
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;
function maybeSweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, w] of store) {
    if (w.resetAt <= now) store.delete(k);
  }
}

// Core check. Pass the current time explicitly in tests for determinism.
export function checkRateLimit(
  bucket: string,
  client: string,
  rule: RateLimitRule,
  now: number = Date.now()
): RateLimitResult {
  try {
    maybeSweep(now);
    const key = `${bucket}:${client}`;
    const existing = store.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + rule.windowMs;
      store.set(key, { count: 1, resetAt });
      return { ok: true, limit: rule.limit, remaining: rule.limit - 1, resetAt, retryAfterSec: 0 };
    }

    if (existing.count >= rule.limit) {
      return {
        ok: false,
        limit: rule.limit,
        remaining: 0,
        resetAt: existing.resetAt,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return {
      ok: true,
      limit: rule.limit,
      remaining: rule.limit - existing.count,
      resetAt: existing.resetAt,
      retryAfterSec: 0,
    };
  } catch {
    // Fail open: never lock users out because of a limiter fault.
    return { ok: true, limit: rule.limit, remaining: rule.limit, resetAt: now, retryAfterSec: 0 };
  }
}

// Standard headers for a result, so handlers stay DRY.
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.ceil(r.resetAt / 1000)),
  };
  if (!r.ok) h["Retry-After"] = String(r.retryAfterSec);
  return h;
}

// Best-effort client identity from proxy headers. x-forwarded-for's FIRST hop is
// the real client (subsequent hops are proxies). Falls back to a constant so the
// limiter still degrades to a coarse global cap if no IP is available.
export function clientIp(req: { headers: Headers }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// Canned rules. Tunable via env without a code change.
function ruleFromEnv(name: string, defLimit: number, defWindowSec: number): RateLimitRule {
  const limit = Number(process.env[`RL_${name}_LIMIT`]) || defLimit;
  const windowSec = Number(process.env[`RL_${name}_WINDOW_SEC`]) || defWindowSec;
  return { limit, windowMs: windowSec * 1000 };
}

export const RATE_RULES = {
  // Auth is the brute-force surface — tight.
  auth: () => ruleFromEnv("AUTH", 10, 60),
  // Public, unauthenticated API (key-gated but still abusable).
  publicApi: () => ruleFromEnv("PUBLIC_API", 60, 60),
};

// Test-only: reset the in-memory store between cases.
export function __resetRateLimit(): void {
  store.clear();
  lastSweep = 0;
}
