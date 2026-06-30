import { NextRequest, NextResponse } from "next/server";
import { addAssetPhoto, listAssetPhotos } from "@/lib/assets/repository";
import { requirePermission } from "@/lib/auth/guard";
import { putObject } from "@/lib/storage";
import { id } from "@/lib/util";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per photo
const OK_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const GET = safeHandler("assets.photos.list", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id: assetId } = await params;
  try {
    const photos = await listAssetPhotos(gate.user.orgId, assetId);
    return NextResponse.json({ photos });
  } catch (err) {
    console.error("GET photos failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to load photos." }, { status: 500 });
  }
});

// Upload one or more photos (multipart). technician+ (manage_assets).
export const POST = safeHandler("assets.photos.upload", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_assets");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id: assetId } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Expected multipart form data." }, { status: 400 });
  }
  const caption = (form.get("caption") as string) || null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "bad_request", message: "No files provided." }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    if (file.type && !OK_MIME.includes(file.type)) {
      created.push({ ok: false, filename: file.name, error: `Unsupported type ${file.type}` });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      created.push({ ok: false, filename: file.name, error: "File too large (max 15 MB)." });
      continue;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const key = `assets/${assetId}/${id("photo")}.${ext}`;
    try {
      const storagePath = await putObject(key, buffer, file.type || "image/jpeg");
      const photo = await addAssetPhoto(
        user.orgId,
        assetId,
        { storagePath, caption, mimeType: file.type || null, sizeBytes: buffer.length },
        user.email
      );
      if (!photo) {
        return NextResponse.json({ error: "not_found", message: "Asset not found." }, { status: 404 });
      }
      created.push({ ok: true, photo });
    } catch (err) {
      console.error("photo upload failed", err);
      created.push({ ok: false, filename: file.name, error: "Storage failed." });
    }
  }
  return NextResponse.json({ results: created }, { status: 201 });
});
