import { NextRequest, NextResponse } from "next/server";
import {
  createWorkOrderRequest,
  listRequests,
} from "@/lib/workorders/repository";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

// GET /api/work-orders/requests?approval=pending|rejected|approved
// The approvals queue. Visible to anyone who can view; the approve/reject
// actions themselves are gated separately (approve_work_order).
export async function GET(req: NextRequest) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const ap = req.nextUrl.searchParams.get("approval");
  const approval =
    ap === "rejected" || ap === "approved" ? ap : ("pending" as const);
  const requests = await listRequests(user.orgId, approval);
  return NextResponse.json({ requests });
}

// POST /api/work-orders/requests — submit a maintenance request that requires
// manager/supervisor approval before it becomes an active work order.
// RBAC: request_work_order (technicians and viewers included).
export async function POST(req: NextRequest) {
  const gate = await requirePermission("request_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await req.json().catch(() => ({}));
  const symptom = (body.symptom || body.description || body.title || "").trim();
  if (!symptom) {
    return NextResponse.json(
      { error: "symptom required", message: "Describe what needs maintenance." },
      { status: 400 }
    );
  }
  const wo = await createWorkOrderRequest(
    user.orgId,
    {
      title: body.title ?? null,
      symptom,
      description: body.description ?? null,
      assetId: body.assetId ?? null,
      area: body.area ?? null,
      priority: body.priority,
      type: body.type,
    },
    user.id
  );
  return NextResponse.json({ workOrder: wo }, { status: 201 });
}
