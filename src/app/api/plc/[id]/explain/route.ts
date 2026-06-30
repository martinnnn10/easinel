import { NextRequest, NextResponse } from "next/server";
import { getPlcProject } from "@/lib/plc/store";
import { resolveNode } from "@/lib/plc/nodes";
import { explainNode } from "@/lib/plc/explain";
import { logClick } from "@/lib/plc/clicklog";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/plc/:id/explain  { nodeId, question? }
// Returns a plain-English explanation of the node (live Claude or demo engine).
export const POST = safeHandler("plc.explain", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("ask_copilot");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { nodeId?: string; question?: string };
  const nodeId = body.nodeId ?? "";
  const t0 = Date.now();

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  try {
    const project = await getPlcProject(orgId, id);
    if (!project) {
      return NextResponse.json({ error: "PLC project not found" }, { status: 404 });
    }
    const detail = resolveNode(project.ir, nodeId);
    if (!detail.found && !detail.aiContext) {
      await logClick(orgId, { projectId: id, nodeId, nodeType: detail.type, outcome: "missing_node", detail: "explain: node not found", ms: Date.now() - t0 });
      return NextResponse.json({
        explanation:
          detail.notice ??
          "There isn't enough parsed information about this element to explain it. Re-export the full project as .L5X from Studio 5000 for richer detail.",
        live: false,
      });
    }
    const { text, live } = await explainNode(detail, body.question);
    await logClick(orgId, { projectId: id, nodeId, nodeType: detail.type, outcome: "ok", detail: `explain (${live ? "live" : "demo"})`, ms: Date.now() - t0 });
    return NextResponse.json({ explanation: text, live });
  } catch (err) {
    await logClick(orgId, { projectId: id, nodeId, outcome: "error", detail: (err as Error).message, ms: Date.now() - t0 });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});
