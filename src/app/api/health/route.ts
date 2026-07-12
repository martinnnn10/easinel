import { NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { demoModeEnabled } from "@/lib/util";
import { authRequired as authRequiredFn } from "@/lib/auth/session";
import { activeProviderName, activeProviderModel, hasLiveProvider, lastProviderError } from "@/lib/ai/providers";
import { lastSuccessAt } from "@/lib/ai/usage";
import { coarseCategory } from "@/lib/health/coarseCategory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness + readiness probe for load balancers and uptime monitors.
//   200 → process is up AND the database answers a trivial query.
//   503 → process is up but a dependency (DB) is unhealthy.
// Intentionally unauthenticated and leaks no tenant data — only coarse status.
export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  let dbError: string | undefined;
  try {
    await ensureDb();
    await db.run(sql`SELECT 1`);
    dbOk = true;
  } catch (err) {
    dbError = (err as Error).message;
    // Raw detail server-side only — never in the public response body.
    console.error("[health] database check failed:", dbError);
  }
  const providerErrorRaw = lastProviderError();
  if (providerErrorRaw) console.error("[health] last provider error:", providerErrorRaw);

  // Auth posture. Login is MANDATORY BY DEFAULT for the real Production
  // Workspace; only the isolated demo, or an explicit opt-out, runs open. We
  // report the canonical effective state and flag any real (non-demo) workspace
  // reachable without a login wall (a deliberate insecure opt-out).
  const authRequired = authRequiredFn();
  // true = a real workspace is reachable without login (someone opted out).
  const insecureOpenProduction = !demoModeEnabled() && !authRequired;

  const body = {
    status: dbOk ? "ok" : "degraded",
    service: "eas-intelligence",
    version: process.env.APP_VERSION ?? "1.0.0",
    checks: {
      database: dbOk ? "ok" : "down",
    },
    // AI provider posture — surfaced so a silent deterministic fallback is never
    // invisible. aiProviderConfigured=false means the Copilot is running the
    // deterministic engine (no live LLM key set, e.g. ANTHROPIC_API_KEY="").
    aiProviderConfigured: hasLiveProvider(),
    aiProvider: activeProviderName(),
    aiProviderName: activeProviderName(),
    aiModel: activeProviderModel(),
    mode: hasLiveProvider() ? "live" : "fallback",
    // Coarse category only (auth | rate_limit | upstream | down | null) — never
    // the raw provider error string. Raw detail is in server logs.
    providerErrorCategory: coarseCategory(providerErrorRaw),
    lastSuccessAt: lastSuccessAt(),
    aiConfigured: hasLiveProvider(),
    security: {
      authRequired,
      // true = ACTION REQUIRED: set AUTH_REQUIRED=true before serving real users.
      insecureOpenProduction,
    },
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
