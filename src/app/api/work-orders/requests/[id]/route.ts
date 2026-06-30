import { NextRequest, NextResponse } from "next/server";
import { approveRequest, rejectRequest } from "@/lib/workorders/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/work-orders/requests/[id] — approve or reject a pending request.
// Body: { action: "approve" | "reject", note?, reason? }
// RBAC: approve_work_order (owner/admin/manager only — the maintenance
// manager/supervisor sign-off).
export const POST = safeHandler("work-orders.requests.decision", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("approve_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();

  if (action === "approve") {
    const wo = await approveRequest(user.orgId, id, user.id, body.note ?? null);
    if (!wo) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ workOrder: wo });
  }

  if (action === "reject") {
    const reason = (body.reason || "").trim();
    if (!reason) {
      return NextResponse.json(
        { error: "reason required", message: "A rejection reason is required." },
        { status: 400 }
      );
    }
    const wo = await rejectRequest(user.orgId, id, user.id, reason);
    if (!wo) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ workOrder: wo });
  }

  return NextResponse.json(
    { error: "invalid_action", message: "action must be 'approve' or 'reject'." },
    { status: 400 }
  );
});
