import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { calculateKpis } from "@/lib/kpi/metrics";

export const runtime = "nodejs";

// GET /api/dashboard — return KPI metrics for the caller's org.
export const GET = safeHandler("dashboard.get", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;

  // Optional period query param (default 90 days)
  const url = new URL(req.url);
  const periodDays = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 90));

  const kpis = await calculateKpis(orgId, periodDays);
  return NextResponse.json(kpis);
});
