import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { calculatePilotValue } from "@/lib/kpi/pilotValue";

export const runtime = "nodejs";

// GET /api/roi?days=90 — the pilot value summary (buyer/exec view). Owner/admin
// only (manage_billing): it's the dollars-and-outcomes story a buyer screenshots.
// Every number is computed from this org's own real records; org-scoped.
export const GET = safeHandler("roi.get", async (req: NextRequest) => {
  const gate = await requirePermission("manage_billing");
  if (gate instanceof NextResponse) return gate;
  const days = Math.min(365, Math.max(30, Number(req.nextUrl.searchParams.get("days")) || 90));
  const value = await calculatePilotValue(gate.user.orgId, days);
  return NextResponse.json(value);
});
