import { NextRequest, NextResponse } from "next/server";
import { getPlcProject } from "@/lib/plc/store";
import { searchNodes } from "@/lib/plc/nodes";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

// GET /api/plc/:id/search?q=motor
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const project = await getPlcProject(gate.user.orgId, id);
    if (!project) return NextResponse.json({ hits: [] }, { status: 200 });
    const hits = searchNodes(project.ir, q);
    return NextResponse.json({ hits });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, hits: [] }, { status: 500 });
  }
}
