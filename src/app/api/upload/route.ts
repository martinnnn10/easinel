import { NextRequest, NextResponse } from "next/server";
import { ingestFile } from "@/lib/rag/ingest";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { canUpload } from "@/lib/billing/limits";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = safeHandler("upload.post", async (req: NextRequest) => {
  const gate = await requirePermission("upload_documents");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;

  // Guard the content type BEFORE parsing: calling req.formData() on a
  // non-multipart request throws deep in the runtime and surfaces as an opaque
  // 500. Fail fast with an honest 400 instead.
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "bad_content_type", message: "Uploads must be sent as multipart/form-data." },
      { status: 400 }
    );
  }
  const form = await req.formData();
  const assetId = (form.get("assetId") as string) || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // Plan STORAGE limit — block the whole batch if it would exceed the org's cap.
  // Existing files are never touched. (Warning at 80% is surfaced by the UI via
  // /api/billing usage.) 413 Payload Too Large with a professional message.
  const incomingBytes = files.reduce((n, f) => n + (f.size || 0), 0);
  const up = await canUpload(orgId, incomingBytes);
  if (!up.allowed) {
    return NextResponse.json(
      {
        error: "storage_limit_reached",
        message: up.reason,
        usedBytes: up.status.usedBytes,
        limitBytes: up.status.limitBytes,
      },
      { status: 413 }
    );
  }

  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file
  const results = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      results.push({
        ok: false,
        filename: file.name,
        status: "error",
        indexed: false,
        message: `"${file.name}" is ${(buffer.length / 1048576).toFixed(1)} MB, which exceeds the 50 MB upload limit.`,
      });
      continue;
    }
    try {
      const res = await ingestFile(
        orgId,
        { name: file.name, type: file.type, buffer },
        { assetId }
      );
      results.push({ ok: true, ...res });
    } catch (err) {
      results.push({
        ok: false,
        filename: file.name,
        status: "error",
        indexed: false,
        message: (err as Error).message,
      });
    }
  }

  const indexed = results.filter((r) => (r as { indexed?: boolean }).indexed).length;
  const summary = {
    total: results.length,
    indexed,
    notIndexed: results.length - indexed,
  };

  return NextResponse.json({ results, summary });
});
