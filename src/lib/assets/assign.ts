// ─────────────────────────────────────────────────────────────────────────
// Asset assignment + numbering helpers.
//
// Two concerns, both pure-ish and org-scoped:
//   1. suggestAssetNumber(): build a human-readable, collision-safe asset tag of
//      the form SITE-LINE-MACHINE-SEQUENCE (e.g. PLNT1-LNA-CONV-001). The user
//      can always override the suggestion before saving.
//   2. resolveAssetForGeneration(): given a model / serial / free-text identity,
//      find the most probable EXISTING asset (so a PM/WO attaches to the right
//      machine instead of creating a duplicate), plus a prefilled draft for a
//      NEW asset if the user chooses to create one.
//
// These never mutate data — they only read and propose. Creation/assignment is
// an explicit, separate user action.
// ─────────────────────────────────────────────────────────────────────────

import { listAssets, type Asset } from "@/lib/assets/repository";

// Strip to A–Z0–9, uppercase, and clamp length for a tag segment.
function seg(input: string | null | undefined, max = 5): string {
  if (!input) return "";
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, max);
}

// A short, meaningful abbreviation for a machine, preferring type then name.
function machineSeg(opts: { assetType?: string | null; name?: string | null; model?: string | null }): string {
  const typeMap: Record<string, string> = {
    conveyor: "CONV",
    pump: "PUMP",
    gearbox: "GBOX",
    drive: "DRV",
    vfd: "VFD",
    motor: "MOT",
    compressor: "CMPR",
    robot: "ROB",
    press: "PRES",
    packaging: "PKG",
    hvac: "HVAC",
  };
  const t = (opts.assetType || "").toLowerCase().trim();
  if (t && typeMap[t]) return typeMap[t];
  if (t) return seg(t, 4);
  return seg(opts.name || opts.model, 4) || "AST";
}

export interface SuggestNumberInput {
  site?: string | null;
  area?: string | null;
  line?: string | null;
  assetType?: string | null;
  name?: string | null;
  model?: string | null;
}

export interface SuggestNumberResult {
  /** the suggested, collision-safe tag (editable by the user) */
  suggestion: string;
  /** the SITE-LINE-MACHINE prefix (before the numeric sequence) */
  prefix: string;
  /** the chosen sequence number, zero-padded to 3 */
  sequence: string;
}

// Build SITE-LINE-MACHINE-### that does not collide with an existing asset_tag
// in this org. Sequence increments until free. Falls back to sensible defaults
// when location parts are missing, so a number is ALWAYS produced.
export async function suggestAssetNumber(
  orgId: string,
  input: SuggestNumberInput
): Promise<SuggestNumberResult> {
  const site = seg(input.site) || "SITE";
  // Prefer line; fall back to area for the middle segment.
  const line = seg(input.line) || seg(input.area) || "GEN";
  const machine = machineSeg(input);
  const prefix = `${site}-${line}-${machine}`;

  const existing = await listAssets(orgId, {});
  const taken = new Set(
    existing
      .map((a) => (a.assetTag || "").toUpperCase().trim())
      .filter(Boolean)
  );

  let n = 1;
  let candidate = `${prefix}-${String(n).padStart(3, "0")}`;
  while (taken.has(candidate.toUpperCase()) && n < 1000) {
    n += 1;
    candidate = `${prefix}-${String(n).padStart(3, "0")}`;
  }
  return { suggestion: candidate, prefix, sequence: String(n).padStart(3, "0") };
}

// ───────────────────────── Assignment resolution ─────────────────────────

export interface ResolveIdentity {
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  /** free-text machine description (e.g. "SEW R97 gearbox on line A") */
  text?: string | null;
  assetType?: string | null;
  name?: string | null;
}

export interface AssetMatch {
  asset: Asset;
  /** 0–1 confidence the identity refers to this existing asset */
  confidence: number;
  /** human-readable reason for the match */
  why: string;
}

export interface ResolveResult {
  /** highest-confidence existing match, if any crossed the threshold */
  bestMatch: AssetMatch | null;
  /** other plausible existing assets, ranked */
  candidates: AssetMatch[];
  /** a prefilled draft for creating a NEW asset from the identity */
  newAssetDraft: {
    name: string;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    assetType: string | null;
  };
  /** suggested (editable) asset number for the new-asset path */
  suggestedNumber: string;
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Score an existing asset against the requested identity. Serial is the
// strongest signal, then model, then manufacturer, then free-text overlap.
function scoreAsset(asset: Asset, idn: ResolveIdentity): AssetMatch | null {
  const reasons: string[] = [];
  let score = 0;

  const serial = norm(idn.serialNumber);
  if (serial && norm(asset.serialNumber) && norm(asset.serialNumber) === serial) {
    score = Math.max(score, 0.98);
    reasons.push("exact serial number match");
  }

  const model = norm(idn.model);
  if (model && norm(asset.model)) {
    if (norm(asset.model) === model) {
      score = Math.max(score, 0.8);
      reasons.push("exact model match");
    } else if (norm(asset.model).includes(model) || model.includes(norm(asset.model))) {
      score = Math.max(score, 0.6);
      reasons.push("partial model match");
    }
  }

  const mfr = norm(idn.manufacturer);
  if (mfr && norm(asset.manufacturer) && norm(asset.manufacturer) === mfr) {
    score += 0.1;
    reasons.push("manufacturer match");
  }

  // Free-text overlap against name/model/tag.
  const text = norm(idn.text);
  if (text) {
    const hay = norm([asset.name, asset.model, asset.assetTag, asset.manufacturer].filter(Boolean).join(" "));
    const tokens = text.split(" ").filter((t) => t.length >= 3);
    const hits = tokens.filter((t) => hay.includes(t)).length;
    if (tokens.length && hits) {
      const frac = hits / tokens.length;
      score = Math.max(score, 0.35 + 0.4 * frac);
      reasons.push(`${hits}/${tokens.length} description terms match`);
    }
  }

  if (score <= 0) return null;
  return { asset, confidence: Math.min(1, score), why: reasons.join(", ") };
}

export async function resolveAssetForGeneration(
  orgId: string,
  idn: ResolveIdentity
): Promise<ResolveResult> {
  const all = await listAssets(orgId, {});
  const scored = all
    .map((a) => scoreAsset(a, idn))
    .filter((m): m is AssetMatch => m != null)
    .sort((a, b) => b.confidence - a.confidence);

  // A "best match" needs reasonable confidence; below this we suggest creating new.
  const bestMatch = scored.length && scored[0].confidence >= 0.6 ? scored[0] : null;

  const draftName =
    idn.name?.trim() ||
    [idn.manufacturer, idn.model].filter(Boolean).join(" ").trim() ||
    (idn.text?.trim() ? idn.text.trim().slice(0, 60) : "") ||
    "New Asset";

  const suggested = await suggestAssetNumber(orgId, {
    assetType: idn.assetType,
    name: draftName,
    model: idn.model,
  });

  return {
    bestMatch,
    candidates: scored.slice(0, 5),
    newAssetDraft: {
      name: draftName,
      manufacturer: idn.manufacturer ?? null,
      model: idn.model ?? null,
      serialNumber: idn.serialNumber ?? null,
      assetType: idn.assetType ?? null,
    },
    suggestedNumber: suggested.suggestion,
  };
}
