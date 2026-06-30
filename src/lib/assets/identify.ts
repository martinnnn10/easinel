// ─────────────────────────────────────────────────────────────────────────
// MACHINE IDENTIFICATION — the asset-first entry point.
//
// A technician starts by identifying the machine, not by opening a record type.
// This turns any signal a tech can produce in the field — a typed asset/serial/
// model number, a scanned QR/barcode, or a photo of the nameplate — into a set
// of candidate EXISTING assets (so work attaches to the right machine) plus a
// prefilled draft to create the machine if it's genuinely new.
//
// Nothing here mutates data; it reads and proposes. Photo reading uses the live
// vision provider when a key is present and degrades gracefully (honest note,
// never invented identity) when it is not.
// ─────────────────────────────────────────────────────────────────────────

import {
  resolveAssetForGeneration,
  type ResolveResult,
} from "@/lib/assets/assign";
import { getLiveChatProvider } from "@/lib/ai/providers";

export interface IdentifyImage {
  mediaType: string; // image/png | image/jpeg | image/webp | image/gif
  dataBase64: string;
  filename?: string;
}

export interface IdentifyInput {
  /** typed free text: an asset tag, serial, model, or machine name */
  text?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  assetType?: string | null;
  /** a captured nameplate photo (vision read when a live provider is present) */
  image?: IdentifyImage | null;
}

export interface IdentifyResult extends ResolveResult {
  /** the identity actually used for matching (after any photo read) */
  identity: {
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    assetType: string | null;
    text: string | null;
  };
  /** how the identity was obtained: typed | scan | photo | photo+typed */
  method: string;
  /** human-facing note (e.g. why a photo couldn't be read) */
  note: string;
}

interface NameplateRead {
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  assetType: string | null;
}

// Ask the live vision provider to read a nameplate photo into structured fields.
// Returns null (never invented data) when no vision provider is configured or
// the read fails / is unparseable.
async function readNameplate(image: IdentifyImage): Promise<NameplateRead | null> {
  const provider = getLiveChatProvider();
  if (!provider || !provider.meta.vision) return null;
  try {
    let text = "";
    const gen = provider.stream({
      system:
        "You read industrial equipment NAMEPLATES from a photo. Extract ONLY what is " +
        "clearly legible. Return STRICT JSON with keys manufacturer, model, serialNumber, " +
        "assetType (one of: motor, gearbox, pump, conveyor, compressor, drive, robot, " +
        "press, packaging, hvac, other). Use null for any field you cannot read with " +
        "confidence. Never guess or invent values. Return ONLY the JSON object.",
      maxTokens: 300,
      messages: [
        {
          role: "user",
          content: "Read this machine nameplate and return the JSON.",
          images: [{ mediaType: image.mediaType, dataBase64: image.dataBase64, filename: image.filename }],
        },
      ],
    });
    for await (const delta of gen) text += delta;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<NameplateRead>;
    return {
      manufacturer: parsed.manufacturer?.toString().trim() || null,
      model: parsed.model?.toString().trim() || null,
      serialNumber: parsed.serialNumber?.toString().trim() || null,
      assetType: parsed.assetType?.toString().trim() || null,
    };
  } catch {
    return null;
  }
}

export async function identifyMachine(
  orgId: string,
  input: IdentifyInput
): Promise<IdentifyResult> {
  let manufacturer = input.manufacturer?.trim() || null;
  let model = input.model?.trim() || null;
  let serialNumber = input.serialNumber?.trim() || null;
  let assetType = input.assetType?.trim() || null;
  const text = input.text?.trim() || null;

  const typedSomething = Boolean(manufacturer || model || serialNumber || text);
  let note = "";
  let usedPhoto = false;

  if (input.image) {
    const read = await readNameplate(input.image);
    if (read) {
      usedPhoto = true;
      // Typed fields win over an OCR read (the human is more authoritative).
      manufacturer = manufacturer || read.manufacturer;
      model = model || read.model;
      serialNumber = serialNumber || read.serialNumber;
      assetType = assetType || read.assetType;
      note = "Read the nameplate from the photo. Confirm the match below.";
    } else {
      note =
        "Photo reading needs the live AI vision model (add an API key). Type the asset, serial, or model number instead.";
    }
  }

  const resolution = await resolveAssetForGeneration(orgId, {
    manufacturer,
    model,
    serialNumber,
    assetType,
    text,
  });

  if (!note) {
    if (resolution.bestMatch) {
      note = `Best match: ${resolution.bestMatch.asset.name}. Confirm it's the right machine.`;
    } else if (resolution.candidates.length > 0) {
      note = `Found ${resolution.candidates.length} possible machine${resolution.candidates.length > 1 ? "s" : ""}. Which one?`;
    } else if (typedSomething || usedPhoto) {
      note = "No existing machine matched. Create it to continue — work always belongs to a machine.";
    } else {
      note = "Search by asset number, serial, or model — or scan/snap the nameplate.";
    }
  }

  const method = usedPhoto
    ? typedSomething
      ? "photo+typed"
      : "photo"
    : typedSomething
      ? "typed"
      : "none";

  return {
    ...resolution,
    identity: { manufacturer, model, serialNumber, assetType, text },
    method,
    note,
  };
}
