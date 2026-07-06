import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { findPriorFixes } from "@/lib/workorders/recurrence";

export const runtime = "nodejs";

// POST /api/work-orders/recurrence — "have we seen this before?" Given a symptom
// (and optional asset), returns the plant's own prior proven fix from closed
// corrective work orders, or { priorFix: null } when there's no real match.
export const POST = safeHandler("workorders.recurrence", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const priorFix = await findPriorFixes(gate.user.orgId, {
    assetId: typeof body.assetId === "string" ? body.assetId : null,
    symptom: typeof body.symptom === "string" ? body.symptom : null,
  });
  return NextResponse.json({ priorFix });
});
