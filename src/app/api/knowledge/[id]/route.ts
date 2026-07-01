import { NextRequest, NextResponse } from "next/server";
import { getDocumentDetail } from "@/lib/queries";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/knowledge/:id — a single document's detail: metadata, linked asset,
// indexing status, extracted-text preview, and whether the original is openable.
// Strictly org-scoped (a document id alone can never reach another tenant).
export const GET = safeHandler("knowledge.detail", async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const detail = await getDocumentDetail(gate.user.orgId, id);
  if (!detail) {
    return NextResponse.json({ error: "not_found", message: "Document not found." }, { status: 404 });
  }
  return NextResponse.json(detail);
});
