import { NextRequest, NextResponse } from "next/server";
import { saveLesson } from "@/lib/lessons";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

// POST /api/lessons — persist a resolved diagnosis as a retrievable lesson learned.
export async function POST(req: NextRequest) {
  const gate = await requirePermission("ask_copilot");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const problem = (body.problem ?? "").trim();
  const resolution = (body.resolution ?? "").trim();
  if (!problem || !resolution) {
    return NextResponse.json(
      { error: "`problem` and `resolution` are required." },
      { status: 400 }
    );
  }
  const result = await saveLesson(gate.user.orgId, {
    title: body.title || problem,
    problem,
    resolution,
    assetId: body.assetId ?? null,
  });
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
