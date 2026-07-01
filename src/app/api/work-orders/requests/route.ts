import { NextRequest, NextResponse } from "next/server";
import {
  createWorkOrderRequest,
  listRequests,
} from "@/lib/workorders/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody, Priority, WoType } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

const CreateRequestSchema = z
  .object({
    symptom: z.string().max(4000).optional().nullable(),
    title: z.string().max(300).optional().nullable(),
    description: z.string().max(20000).optional().nullable(),
    assetId: z.string().trim().optional().nullable(),
    area: z.string().max(200).optional().nullable(),
    priority: Priority.optional(),
    type: WoType.optional(),
  })
  .passthrough();

// GET /api/work-orders/requests?approval=pending|rejected|approved
// The approvals queue. Visible to anyone who can view; the approve/reject
// actions themselves are gated separately (approve_work_order).
export const GET = safeHandler("work-orders.requests.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const ap = req.nextUrl.searchParams.get("approval");
  const approval =
    ap === "rejected" || ap === "approved" ? ap : ("pending" as const);
  const requests = await listRequests(user.orgId, approval);
  return NextResponse.json({ requests });
});

// POST /api/work-orders/requests — submit a maintenance request that requires
// manager/supervisor approval before it becomes an active work order.
// RBAC: request_work_order (technicians and viewers included).
export const POST = safeHandler("work-orders.requests.create", async (req: NextRequest) => {
  const gate = await requirePermission("request_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const parsed = await parseBody(req, CreateRequestSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
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
});
