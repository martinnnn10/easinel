import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { listGapsByAsset } from "@/lib/knowledge/gaps";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/knowledge-gaps — machines where the Copilot lacked the plant's own
// documents to answer confidently, most-asked first. Org-scoped. Visible to
// anyone who can upload documents (they're the ones who can close the gap).
export const GET = safeHandler("knowledge-gaps.list", async () => {
  const gate = await requirePermission("upload_documents");
  if (gate instanceof NextResponse) return gate;
  const gaps = await listGapsByAsset(gate.user.orgId);
  return NextResponse.json({ gaps });
});
