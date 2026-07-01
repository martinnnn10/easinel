import { NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { sql } from "drizzle-orm";

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
  }

  // Auth posture. Login is now secure-by-default: the production workspace
  // enforces auth unless the operator EXPLICITLY opted out. We report the
  // effective state, and flag the (deliberate) insecure opt-out for monitors.
  const productionWorkspace = process.env.OPEN_MODE_ORG === "production";
  const explicitOptOut = process.env.ALLOW_INSECURE_OPEN_PRODUCTION === "true";
  const authEnforced =
    process.env.AUTH_REQUIRED === "true" || (productionWorkspace && !explicitOptOut);
  // true only when someone deliberately turned OFF auth on real production data.
  const insecureOpenProduction = productionWorkspace && !authEnforced;
  const authRequired = authEnforced;

  const body = {
    status: dbOk ? "ok" : "degraded",
    service: "eas-intelligence",
    version: process.env.APP_VERSION ?? "1.0.0",
    checks: {
      database: dbOk ? "ok" : "down",
      ...(dbError ? { databaseError: dbError } : {}),
    },
    aiConfigured: Boolean(
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY
    ),
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
