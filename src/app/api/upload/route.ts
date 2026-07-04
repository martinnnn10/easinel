import { NextRequest, NextResponse } from "next/server";
import { ingestFile } from "@/lib/rag/ingest";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { uploadEntitlement } from "@/lib/billing/entitlements";

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

  // Central entitlement: blocked during billing grace (402) or when the batch
  // would exceed the plan storage cap (413). Existing files are never touched.
  const incomingBytes = files.reduce((n, f) => n + (f.size || 0), 0);
  const up = await uploadEntitlement(orgId, incomingBytes);
  if (!up.allowed) {
    return NextResponse.json(
      { error: up.code === 402 ? "billing_inactive" : "storage_limit_reached", message: up.reason },
      { status: up.code }
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
