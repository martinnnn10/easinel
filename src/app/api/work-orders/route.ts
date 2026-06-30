import { NextRequest, NextResponse } from "next/server";
import {
  createWorkOrder,
  listWorkOrders,
  workOrderStats,
  type WorkOrderFilters,
} from "@/lib/workorders/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody, Priority, WoType } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

// A work order must be born with a handle on what's wrong: a title OR a symptom.
const CreateWorkOrderSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    symptom: z.string().trim().max(4000).optional().nullable(),
    description: z.string().max(20000).optional().nullable(),
    assetId: z.string().trim().optional().nullable(),
    priority: Priority.optional(),
    type: WoType.optional(),
    assignedTo: z.string().trim().optional().nullable(),
    estLaborMins: z.number().int().nonnegative().max(100000).optional().nullable(),
    parts: z.array(z.string()).max(200).optional(),
    safety: z.array(z.string()).max(200).optional(),
    source: z.string().trim().max(60).optional(),
  })
  .refine((b) => Boolean(b.title?.trim() || b.symptom?.trim()), {
    message: "a title or a symptom is required",
    path: ["title"],
  });

// GET /api/work-orders?assetId=&status=&priority=&type=&assignedTo=&search=&stats=1
export const GET = safeHandler("workorders.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const sp = req.nextUrl.searchParams;

  const filters: WorkOrderFilters = {};
  if (sp.get("assetId")) filters.assetId = sp.get("assetId")!;
  if (sp.get("status")) filters.status = sp.get("status")!;
  if (sp.get("priority")) filters.priority = sp.get("priority")!;
  if (sp.get("type")) filters.type = sp.get("type")!;
  if (sp.get("assignedTo")) filters.assignedTo = sp.get("assignedTo")!;
  if (sp.get("search")) filters.search = sp.get("search")!;
  const ap = sp.get("approval");
  if (ap === "approved" || ap === "pending" || ap === "rejected" || ap === "all") {
    filters.approval = ap;
  }

  const workOrders = await listWorkOrders(user.orgId, filters);
  const stats = sp.get("stats") === "1" ? await workOrderStats(user.orgId) : undefined;
  return NextResponse.json({ workOrders, stats });
});

// POST /api/work-orders — create (RBAC: create_work_order). Supports the new
// "symptom" field (the what's-down report) while staying compatible with the
// legacy title/description payload.
export const POST = safeHandler("workorders.create", async (req: NextRequest) => {
  const gate = await requirePermission("create_work_order");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const parsed = await parseBody(req, CreateWorkOrderSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;

  const title = (body.title || body.symptom || "").trim();
  const wo = await createWorkOrder(
    user.orgId,
    {
      title,
      description: body.description,
      symptom: body.symptom ?? null,
      assetId: body.assetId ?? null,
      priority: body.priority,
      type: body.type,
      assignedTo: body.assignedTo,
      estLaborMins: body.estLaborMins,
      parts: body.parts,
      safety: body.safety,
      source: body.source ?? "eas",
    },
    user.id
  );
  return NextResponse.json({ workOrder: wo }, { status: 201 });
});
