import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { reprocessDocument } from "@/lib/rag/ingest";

export const runtime = "nodejs";

// POST /api/knowledge/:id/reprocess — re-run extraction + indexing for a
// document whose original binary is still stored (the "Retry" action for a
// failed/unindexed upload). Requires upload_documents. Strictly org-scoped.
export const POST = safeHandler(
  "knowledge.reprocess",
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const gate = await requirePermission("upload_documents");
    if (gate instanceof NextResponse) return gate;
    const { id } = await ctx.params;
    const result = await reprocessDocument(gate.user.orgId, id);
    return NextResponse.json(result, { status: result.status === "not_found" ? 404 : 200 });
  }
);
