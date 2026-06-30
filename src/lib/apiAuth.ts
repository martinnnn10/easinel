import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { id } from "@/lib/util";

const PREFIX = "eas_live_";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface NewKey {
  id: string;
  name: string;
  prefix: string;
  plaintext: string; // shown exactly once
}

export async function createApiKey(orgId: string, name: string): Promise<NewKey> {
  if (!orgId) throw new Error("createApiKey() requires orgId");
  await ensureDb();
  const secret = randomBytes(24).toString("base64url");
  const plaintext = PREFIX + secret;
  const prefix = plaintext.slice(0, PREFIX.length + 6);
  const keyId = id("key");
  await db.insert(apiKeys).values({
    id: keyId,
    orgId,
    name,
    prefix,
    hashedKey: hashKey(plaintext),
  });
  return { id: keyId, name, prefix, plaintext };
}

// Validate a bearer key. Returns the orgId on success, null on failure.
export async function verifyApiKey(req: NextRequest): Promise<string | null> {
  await ensureDb();
  const header =
    req.headers.get("authorization") || req.headers.get("x-api-key") || "";
  const raw = header.replace(/^Bearer\s+/i, "").trim();
  if (!raw.startsWith(PREFIX)) return null;

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.hashedKey, hashKey(raw)), isNull(apiKeys.revokedAt)));
  const key = rows[0];
  if (!key) return null;

  // Touch last-used (best effort).
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id));

  return key.orgId;
}

// ── Per-org fixed-window rate limiting ──────────────────────────────────────
// A pragmatic in-memory limiter: fine for a single-node deployment and a real
// guardrail against runaway scripts. For multi-node it becomes a Redis counter;
// the call site does not change. Default 120 requests / 60s per org.
const RATE_LIMIT = Number(process.env.API_RATE_LIMIT ?? 120);
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function checkRate(orgId: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(orgId);
  if (!b || now >= b.resetAt) {
    const resetAt = now + RATE_WINDOW_MS;
    buckets.set(orgId, { count: 1, resetAt });
    return { ok: true, remaining: RATE_LIMIT - 1, resetAt };
  }
  b.count += 1;
  return { ok: b.count <= RATE_LIMIT, remaining: Math.max(0, RATE_LIMIT - b.count), resetAt: b.resetAt };
}

// Wrap a public API handler with key auth, rate limiting, and a consistent error
// envelope. Every response carries X-RateLimit-* headers so clients can back off.
export function withApiKey(
  handler: (req: NextRequest, orgId: string) => Promise<Response>
) {
  return async (req: NextRequest) => {
    const orgId = await verifyApiKey(req);
    if (!orgId) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message:
            "Provide a valid API key as `Authorization: Bearer eas_live_...`. Create one in Settings → Developers.",
        },
        { status: 401 }
      );
    }

    const rate = checkRate(orgId);
    const rateHeaders: Record<string, string> = {
      "X-RateLimit-Limit": String(RATE_LIMIT),
      "X-RateLimit-Remaining": String(rate.remaining),
      "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.ok) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: `Rate limit of ${RATE_LIMIT} requests/minute exceeded. Retry after the reset time.`,
        },
        {
          status: 429,
          headers: { ...rateHeaders, "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
        }
      );
    }

    try {
      const res = await handler(req, orgId);
      for (const [k, v] of Object.entries(rateHeaders)) res.headers.set(k, v);
      return res;
    } catch (err) {
      return NextResponse.json(
        { error: "internal_error", message: (err as Error).message },
        { status: 500, headers: rateHeaders }
      );
    }
  };
}
