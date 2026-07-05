import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// PATCH /api/work-orders/[id]/package/approve — Planner approves/rejects the work package
export const PATCH = safeHandler("workpackage.approve", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("approve_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id: woId } = await params;
  const body = await req.json();
  const { decision, partsAvailability } = body; // decision: 'approved' | 'rejected'

  const [pkg] = await db
    .select()
    .from(schema.workPackages)
    .where(and(eq(schema.workPackages.workOrderId, woId), eq(schema.workPackages.orgId, user.orgId)));

  if (!pkg) {
    return NextResponse.json({ error: "not_found", message: "Work package not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    plannerApproval: decision || "approved",
    approvedBy: user.email,
    approvedAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (partsAvailability) {
    updates.partsAvailability = partsAvailability;
  }

  // If approved and parts are ready, mark as ready to work
  if (decision === "approved" && (partsAvailability === "ready" || pkg.partsAvailability === "ready")) {
    updates.readyToWork = 1;
  }

  await db
    .update(schema.workPackages)
    .set(updates)
    .where(eq(schema.workPackages.id, pkg.id));

  return NextResponse.json({ id: pkg.id, plannerApproval: decision || "approved" });
});
