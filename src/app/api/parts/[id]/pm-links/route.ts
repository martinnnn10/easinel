import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { linkPm } from "@/lib/parts/repository";

export const runtime = "nodejs";

// POST /api/parts/:id/pm-links  { pmProgramId }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.pmProgramId) {
    return NextResponse.json({ error: "bad_request", message: "pmProgramId is required." }, { status: 400 });
  }
  await linkPm(gate.user.orgId, id, body.pmProgramId, gate.user.email);
  return NextResponse.json({ ok: true }, { status: 201 });
}
