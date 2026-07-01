import { NextRequest, NextResponse } from "next/server";
import { getDocumentDetail } from "@/lib/queries";
import { getObject } from "@/lib/storage";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Content types we let the browser render inline (view in a new tab); everything
// else is sent as a download so a click is never a dead end.
const INLINE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/plain",
]);

// GET /api/knowledge/:id/file — stream the ORIGINAL uploaded file. Org-scoped via
// the document lookup, so a file can only be served to its owning tenant. Honest
// 404/410 when the binary isn't retrievable (e.g. text-only lesson, or an
// ephemeral local file lost on restart) instead of a silent dead click.
export const GET = safeHandler("knowledge.file", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;

  const detail = await getDocumentDetail(gate.user.orgId, id);
  if (!detail) {
    return NextResponse.json({ error: "not_found", message: "Document not found." }, { status: 404 });
  }
  const { document } = detail;
  if (!document.storagePath) {
    return NextResponse.json(
      { error: "no_original", message: "This item has no stored original file to open (its text was indexed directly)." },
      { status: 404 }
    );
  }

  let bytes: Buffer;
  try {
    bytes = await getObject(document.storagePath);
  } catch {
    return NextResponse.json(
      { error: "original_unavailable", message: "The original file could not be retrieved from storage. It may have been on ephemeral storage that was cleared on restart — re-upload to restore it." },
      { status: 410 }
    );
  }

  const mime = document.mimeType || "application/octet-stream";
  const wantsDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition = !wantsDownload && INLINE.has(mime) ? "inline" : "attachment";
  const safeName = (document.filename || "file").replace(/[\r\n"]/g, "_");

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      // Private, tenant-scoped content — never cache in shared proxies.
      "Cache-Control": "private, no-store",
    },
  });
});
