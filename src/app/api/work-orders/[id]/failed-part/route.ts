import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { recordFailedPart } from "@/lib/parts/repository";

export const runtime = "nodejs";

// POST /api/work-orders/:id/failed-part
//   { partId }  — link an existing catalog part as the failed part, OR
//   { newPart: { description, partNumber?, manufacturer?, category? } } — create it.
// Links the part⇆WO as "failed", links the WO's asset, and returns rule-based
// stocking/PM suggestions for the part's Field Memory.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.partId && !body.newPart?.description) {
    return NextResponse.json(
      { error: "bad_request", message: "Provide partId or newPart.description." },
      { status: 400 }
    );
  }
  try {
    const result = await recordFailedPart(
      gate.user.orgId,
      { workOrderId: id, partId: body.partId, newPart: body.newPart },
      gate.user.email
    );
    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "failed", message: (err as Error).message }, { status: 400 });
  }
}
