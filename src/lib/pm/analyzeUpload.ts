// ─────────────────────────────────────────────────────────────────────────
// PM UPLOAD INTELLIGENCE — analyze an uploaded PM/manual document and DETECT the
// machine it describes (manufacturer / model / serial / type) plus PM cadence
// hints, WITHOUT saving anything. The caller (UI) shows the detection, lets the
// user CONFIRM (or correct) the asset, and only THEN runs generate + assign.
//
// This is deliberately a read/propose step:
//   • extract text from the buffer (reusing the ingest extractor)
//   • detect identity via regex patterns first, then (when available) refine
//     with the live LLM strictly from the extracted text — never invented
//   • resolve a probable existing asset + a prefilled new-asset draft with an
//     editable suggested number
//
// Tenancy: orgId is required and the asset resolution is org-scoped.
// ─────────────────────────────────────────────────────────────────────────

import { extractDocument } from "@/lib/rag/extract";
import { resolveAssetForGeneration, type ResolveResult } from "@/lib/assets/assign";
import { getLiveChatProvider } from "@/lib/ai/providers";

export interface DetectedIdentity {
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  assetType: string | null;
  /** cadence labels the document mentions, e.g. ["monthly","annual"] */
  cadenceHints: string[];
  /** how identity was derived */
  method: "pattern" | "llm" | "none";
}

export interface AnalyzeUploadResult {
  filename: string;
  extractStatus: string;
  /** true when we recovered readable text to analyze */
  readable: boolean;
  detail?: string;
  identity: DetectedIdentity;
  resolution: ResolveResult | null;
  /** plain-English summary for the confirmation UI */
  summary: string;
}

const TYPE_PATTERNS: { type: string; re: RegExp }[] = [
  { type: "conveyor", re: /conveyor|belt drive/i },
  { type: "pump", re: /\bpump\b|centrifugal|positive displacement/i },
  { type: "gearbox", re: /gearbox|gear reducer|speed reducer|reducer/i },
  { type: "drive", re: /\bvfd\b|variable frequency|inverter|\bmotor\b|servo drive/i },
  { type: "compressor", re: /compressor|air end/i },
  { type: "robot", re: /\brobot\b|manipulator|articulated arm/i },
  { type: "hvac", re: /hvac|chiller|air handler|rooftop unit|\brtu\b/i },
  { type: "press", re: /\bpress\b|stamping|hydraulic press/i },
];

const CADENCE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "monthly", re: /\bmonthly\b|every month|30[ -]?day/i },
  { label: "60-day", re: /60[ -]?day|bi[- ]?monthly/i },
  { label: "quarterly", re: /\bquarterly\b|every quarter|90[ -]?day|3[ -]?month/i },
  { label: "semi-annual", re: /semi[- ]?annual|every six months|180[ -]?day|6[ -]?month/i },
  { label: "annual", re: /\bannual(ly)?\b|yearly|every year|365[ -]?day|12[ -]?month/i },
];

// Conservative regex detection. Only captures values that appear with an
// explicit label so we don't fabricate identity from random tokens.
function detectByPattern(text: string): DetectedIdentity {
  const t = text.slice(0, 20000);

  const grab = (re: RegExp): string | null => {
    const m = t.match(re);
    return m && m[1] ? m[1].trim().replace(/[.,;]+$/, "") : null;
  };

  const model =
    grab(/\bmodel(?:\s*(?:no\.?|number|#))?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-./]{2,30})/i);
  const serialNumber =
    grab(/\b(?:serial(?:\s*(?:no\.?|number))?|s\/n|sn)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-./]{3,30})/i);
  const manufacturer =
    grab(/\b(?:manufacturer|make|mfr\.?|brand|oem)\s*[:#]?\s*([A-Za-z][A-Za-z0-9 &.\-]{2,40})/i);

  let assetType: string | null = null;
  for (const p of TYPE_PATTERNS) {
    if (p.re.test(t)) { assetType = p.type; break; }
  }

  const cadenceHints = CADENCE_PATTERNS.filter((c) => c.re.test(t)).map((c) => c.label);

  const found = Boolean(model || serialNumber || manufacturer || assetType);
  return {
    manufacturer,
    model,
    serialNumber,
    assetType,
    cadenceHints,
    method: found ? "pattern" : "none",
  };
}

// Optional LLM refinement — strictly from the document text. Fills only fields
// the pattern pass missed; never overrides a confidently-pattern-matched value.
async function refineWithLlm(text: string, base: DetectedIdentity): Promise<DetectedIdentity> {
  const provider = getLiveChatProvider();
  if (!provider) return base;
  // If pattern already found model AND (serial OR manufacturer), good enough.
  if (base.model && (base.serialNumber || base.manufacturer)) return base;
  try {
    let out = "";
    const gen = provider.stream({
      system:
        "You extract equipment identity from a maintenance/OEM document. Return ONLY compact JSON: " +
        '{"manufacturer":string|null,"model":string|null,"serialNumber":string|null,"assetType":string|null}. ' +
        "Use null for anything not explicitly stated in the text. Never guess or invent values. " +
        "assetType should be one short word like conveyor, pump, gearbox, drive, compressor, robot, hvac, press, or null.",
      maxTokens: 200,
      messages: [{ role: "user", content: `Document text:\n${text.slice(0, 6000)}` }],
    });
    for await (const d of gen) out += d;
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return base;
    const parsed = JSON.parse(m[0]) as Partial<DetectedIdentity>;
    const clean = (v: unknown): string | null =>
      typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;
    const merged: DetectedIdentity = {
      manufacturer: base.manufacturer ?? clean(parsed.manufacturer),
      model: base.model ?? clean(parsed.model),
      serialNumber: base.serialNumber ?? clean(parsed.serialNumber),
      assetType: base.assetType ?? clean(parsed.assetType),
      cadenceHints: base.cadenceHints,
      method: base.method === "none" ? "llm" : base.method,
    };
    return merged;
  } catch {
    return base;
  }
}

export async function analyzePmUpload(
  orgId: string,
  buffer: Buffer,
  filename: string,
  mime?: string
): Promise<AnalyzeUploadResult> {
  if (!orgId) throw new Error("analyzePmUpload() requires orgId");

  const extracted = await extractDocument(buffer, filename, mime);
  const readable = extracted.status === "extracted" && extracted.text.trim().length > 0;

  if (!readable) {
    return {
      filename,
      extractStatus: extracted.status,
      readable: false,
      detail:
        extracted.detail ||
        "We couldn't read text from this file, so we couldn't auto-detect the machine. You can still enter the machine details manually.",
      identity: { manufacturer: null, model: null, serialNumber: null, assetType: null, cadenceHints: [], method: "none" },
      resolution: null,
      summary: "No readable text — enter the machine details manually to continue.",
    };
  }

  let identity = detectByPattern(extracted.text);
  identity = await refineWithLlm(extracted.text, identity);

  const resolution = await resolveAssetForGeneration(orgId, {
    manufacturer: identity.manufacturer,
    model: identity.model,
    serialNumber: identity.serialNumber,
    assetType: identity.assetType,
    text: filename,
  });

  const idnParts = [identity.manufacturer, identity.model].filter(Boolean).join(" ");
  let summary: string;
  if (!idnParts && !identity.assetType) {
    summary = "We read the document but couldn't confidently detect the machine. Please confirm or enter the machine details below before saving.";
  } else if (resolution.bestMatch) {
    summary = `Detected ${idnParts || identity.assetType}. This looks like your existing asset "${resolution.bestMatch.asset.name}" (${Math.round(resolution.bestMatch.confidence * 100)}% — ${resolution.bestMatch.why}). Confirm the asset before we save the PM program.`;
  } else {
    summary = `Detected ${idnParts || identity.assetType}. No existing asset matched — confirm the suggested new asset (number ${resolution.suggestedNumber}, editable) before we save the PM program.`;
  }

  return {
    filename,
    extractStatus: extracted.status,
    readable: true,
    detail: extracted.detail,
    identity,
    resolution,
    summary,
  };
}
