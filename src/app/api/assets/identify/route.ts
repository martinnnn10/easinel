import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { identifyMachine, type IdentifyImage } from "@/lib/assets/identify";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// POST /api/assets/identify
// Accepts EITHER JSON { text?, manufacturer?, model?, serialNumber?, assetType? }
// (typed entry or a scanned QR/barcode value placed in `text`) OR multipart with
// a `file` nameplate photo (read by the vision model when live). Returns candidate
// EXISTING assets + a prefilled new-asset draft. Read-only — proposes, never saves.
export const POST = safeHandler("assets.identify", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;

  const contentType = req.headers.get("content-type") || "";
  try {
    let image: IdentifyImage | null = null;
    let text: string | null = null;
    let manufacturer: string | null = null;
    let model: string | null = null;
    let serialNumber: string | null = null;
    let assetType: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      text = (form.get("text") as string) || null;
      manufacturer = (form.get("manufacturer") as string) || null;
      model = (form.get("model") as string) || null;
      serialNumber = (form.get("serialNumber") as string) || null;
      assetType = (form.get("assetType") as string) || null;
      if (file && typeof file !== "string") {
        const blob = file as File;
        if (!ALLOWED.has(blob.type)) {
          return NextResponse.json({ error: "Unsupported image type. Use PNG, JPEG, WebP, or GIF." }, { status: 415 });
        }
        const buf = Buffer.from(await blob.arrayBuffer());
        if (buf.byteLength > MAX_IMAGE_BYTES) {
          return NextResponse.json({ error: "Image too large (max 8 MB)." }, { status: 413 });
        }
        image = { mediaType: blob.type, dataBase64: buf.toString("base64"), filename: blob.name };
      }
    } else {
      const body = await req.json().catch(() => ({}));
      text = body.text ?? null;
      manufacturer = body.manufacturer ?? null;
      model = body.model ?? null;
      serialNumber = body.serialNumber ?? null;
      assetType = body.assetType ?? null;
    }

    const result = await identifyMachine(gate.user.orgId, {
      text,
      manufacturer,
      model,
      serialNumber,
      assetType,
      image,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/assets/identify failed", err);
    return NextResponse.json({ error: "Failed to identify machine." }, { status: 500 });
  }
});
