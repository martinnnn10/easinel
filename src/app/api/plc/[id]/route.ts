import { NextRequest, NextResponse } from "next/server";
import { getPlcProject } from "@/lib/plc/store";
import { buildTree } from "@/lib/plc/nodes";
import { logClick } from "@/lib/plc/clicklog";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/plc/:id → { meta, tree } for the Explorer sidebar.
export const GET = safeHandler("plc.get", async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const { id } = await ctx.params;
  const t0 = Date.now();
  try {
    const project = await getPlcProject(orgId, id);
    if (!project) {
      await logClick(orgId, { projectId: id, outcome: "missing_project", detail: "project not found", ms: Date.now() - t0 });
      return NextResponse.json({ error: "PLC project not found" }, { status: 404 });
    }
    const tree = buildTree(project.ir);
    await logClick(orgId, { projectId: id, nodeId: "tree", outcome: "ok", ms: Date.now() - t0 });
    return NextResponse.json({
      meta: {
        id: project.row.id,
        filename: project.row.filename,
        source: project.ir.source,
        fidelity: project.ir.fidelity,
        fidelityNote: project.ir.fidelityNote ?? null,
        controller: project.ir.controller.name,
        processorType: project.ir.controller.processorType ?? null,
        softwareRevision: project.ir.softwareRevision ?? null,
        exportDate: project.ir.exportDate ?? null,
        stats: project.ir.stats,
        assetId: project.row.assetId,
      },
      tree,
    });
  } catch (err) {
    await logClick(orgId, { projectId: id, outcome: "error", detail: (err as Error).message, ms: Date.now() - t0 });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});
