import { NextRequest, NextResponse } from "next/server";
import {
  getWorkOrder,
  updateWorkOrder,
  transitionWorkOrder,
  deleteWorkOrder,
  markSynced,
  listWorkOrderEvents,
} from "@/lib/workorders/repository";
import { requirePermission } from "@/lib/auth/guard";
import { getAdapter } from "@/lib/integrations/adapter";

export const runtime = "nodejs";

// GET /api/work-orders/:id — the work order plus its lifecycle history.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  const workOrder = await getWorkOrder(user.orgId, id);
  if (!workOrder) return NextResponse.json({ error: "not found" }, { status: 404 });
  const history = await listWorkOrderEvents(user.orgId, id);
  return NextResponse.json({ workOrder, history });
}

// PATCH /api/work-orders/:id — status transition (state machine) and/or field
// edits. Both require update_work_order. A status change runs through the state
// machine and is rejected (409) if the transition is illegal.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Field edits (title/description/symptom/resolution/priority/assignment/etc.).
  const editableKeys = [
    "title",
    "description",
    "symptom",
    "resolution",
    "priority",
    "type",
    "assignedTo",
    "estLaborMins",
    "parts",
    "safety",
    "rootCause",
    "failedPart",
    "repairAction",
    "downtimeMins",
  ];
  const hasEdits = editableKeys.some((k) => body[k] !== undefined);
  if (hasEdits) {
    const updated = await updateWorkOrder(user.orgId, id, body, user.id);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Status transition through the state machine.
  if (body.status) {
    const result = await transitionWorkOrder(user.orgId, id, body.status, {
      note: body.note ?? null,
      resolution: body.resolution ?? null,
      actor: user.id,
    });
    if (result.error === "not_found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (result.error) {
      return NextResponse.json(
        { error: "invalid_transition", message: result.error },
        { status: 409 }
      );
    }
    return NextResponse.json({ workOrder: result.workOrder });
  }

  if (!hasEdits) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  const workOrder = await getWorkOrder(user.orgId, id);
  return NextResponse.json({ workOrder });
}

// DELETE /api/work-orders/:id — RBAC: delete_work_order.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("delete_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  const ok = await deleteWorkOrder(user.orgId, id, user.id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// POST /api/work-orders/:id — push this work order out to a connected CMMS
// connector (preserved integrations behavior). RBAC: update_work_order.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const connectorKey = body.connectorKey;
  const wo = await getWorkOrder(user.orgId, id);
  if (!wo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const adapter = getAdapter(connectorKey);
  if (!adapter?.pushWorkOrder) {
    return NextResponse.json(
      { error: "connector cannot receive work orders" },
      { status: 400 }
    );
  }
  const result = await adapter.pushWorkOrder({
    title: wo.title,
    description: wo.description ?? undefined,
    priority: wo.priority,
  });
  await markSynced(user.orgId, id, result.externalSystem, result.externalId, user.id);
  return NextResponse.json({ ok: true, ...result });
}
