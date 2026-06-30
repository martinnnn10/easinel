import { NextRequest, NextResponse } from "next/server";
import { getPlcProject } from "@/lib/plc/store";
import { resolveNode } from "@/lib/plc/nodes";
import { logClick } from "@/lib/plc/clicklog";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

// GET /api/plc/:id/node?nodeId=routine:Main/MainRoutine
// Always returns 200 with a structured payload — even when the node has no
// content — so the UI never hits a dead click. The `found`/`notice` fields
// tell the UI how to render. Failures are classified for the click log.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const { id } = await ctx.params;
  const nodeId = req.nextUrl.searchParams.get("nodeId") ?? "";
  const t0 = Date.now();

  if (!nodeId) {
    await logClick(orgId, { projectId: id, outcome: "bad_request", detail: "missing nodeId", ms: Date.now() - t0 });
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  try {
    const project = await getPlcProject(orgId, id);
    if (!project) {
      await logClick(orgId, { projectId: id, nodeId, outcome: "missing_project", ms: Date.now() - t0 });
      return NextResponse.json(
        {
          found: false,
          type: "unknown",
          id: nodeId,
          title: nodeId,
          notice:
            "The PLC project for this node could not be found. It may have been removed, or the explorer was opened with a stale link. Try reopening the project from Knowledge.",
          data: {},
          breadcrumb: [],
        },
        { status: 200 }
      );
    }

    const detail = resolveNode(project.ir, nodeId);
    const outcome = !detail.found
      ? "missing_node"
      : detail.notice
      ? "empty_content"
      : "ok";
    await logClick(orgId, {
      projectId: id,
      nodeId,
      nodeType: detail.type,
      outcome,
      detail: detail.notice ? detail.notice.slice(0, 120) : undefined,
      ms: Date.now() - t0,
    });
    return NextResponse.json(detail, { status: 200 });
  } catch (err) {
    await logClick(orgId, { projectId: id, nodeId, outcome: "error", detail: (err as Error).message, ms: Date.now() - t0 });
    return NextResponse.json(
      {
        found: false,
        type: "unknown",
        id: nodeId,
        title: nodeId,
        notice: `Something went wrong reading this node: ${(err as Error).message}`,
        data: {},
        breadcrumb: [],
      },
      { status: 200 }
    );
  }
}
