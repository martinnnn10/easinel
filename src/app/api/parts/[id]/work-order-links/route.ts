import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { linkWorkOrder } from "@/lib/parts/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/parts/:id/work-order-links  { workOrderId, role? (used|failed|mentioned) }
export const POST = safeHandler("parts.work-order-links.add", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.workOrderId) {
    return NextResponse.json({ error: "bad_request", message: "workOrderId is required." }, { status: 400 });
  }
  const role = ["used", "failed", "mentioned"].includes(body.role) ? body.role : "used";
  await linkWorkOrder(gate.user.orgId, id, body.workOrderId, role, gate.user.email);
  return NextResponse.json({ ok: true }, { status: 201 });
});
