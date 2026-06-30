// ─────────────────────────────────────────────────────────────────────────
// Failure lookup — deterministic, org-scoped resolution of a free-text Copilot
// question into the REAL structured maintenance records that answer it.
//
// The Copilot's document retrieval (hybrid.ts) is great for manuals/SOPs, but a
// technician usually asks about FAILURES by one of three handles:
//   • asset number / tag        e.g. "what failed on CV-03" / "asset 1042"
//   • part number               e.g. "failures involving 871TM-B10MP18-D4"
//   • general area affected     e.g. "what's been failing in the press area"
//
// This module parses those handles out of the question, resolves them against
// the asset and parts repositories (NO schema change), and assembles a compact,
// grounded "FAILURE LOOKUP" context block listing the matching assets, their
// recent failure work orders (date, symptom, root cause, failed part, repair
// action), and any part failure history. That block is injected into the chat
// context so answers are grounded in the org's own failure records — not just
// whatever a document happens to mention.
//
// Everything here is tenant-scoped: orgId is required and threaded into every
// repository call. It returns "" when nothing relevant is found, so the normal
// document-grounded path is unaffected.
// ─────────────────────────────────────────────────────────────────────────

import { listAssets } from "@/lib/assets/repository";
import { listWorkOrders } from "@/lib/workorders/repository";
import { smartSearch } from "@/lib/parts/search";
import { getFieldMemory } from "@/lib/parts/repository";
import type { Asset, WorkOrder } from "@/lib/db/schema";

export interface FailureLookupResult {
  /** Grounded text block for the prompt context. Empty when nothing matched. */
  context: string;
  /** Whether anything at all was resolved (used for diagnostics/telemetry). */
  matched: boolean;
  matchedAssetIds: string[];
  matchedPartIds: string[];
}

const EMPTY: FailureLookupResult = { context: "", matched: false, matchedAssetIds: [], matchedPartIds: [] };

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}
function dateStr(v: unknown): string {
  const n = ms(v);
  return n ? new Date(n).toISOString().slice(0, 10) : "—";
}

// A work order counts as a "failure record" if it is corrective and/or carries
// any failure-analysis fields. Preventive/inspection WOs are not failures.
function isFailureWorkOrder(w: WorkOrder): boolean {
  if (w.type && w.type !== "corrective") {
    // Still treat as failure if it has explicit failure analysis recorded.
    return Boolean(w.rootCause || w.failedPart || w.symptom);
  }
  return true;
}

// ── Identifier extraction ──────────────────────────────────────────────────

// A candidate part/asset number: a token with both letters and digits, or a
// long digit run, optionally containing - _ / . — e.g. 871TM-B10MP18-D4, 25B-D2P1N4
function extractCodeTokens(q: string): string[] {
  const out = new Set<string>();
  const re = /[A-Za-z0-9][A-Za-z0-9._/-]{2,}/g;
  for (const m of q.match(re) ?? []) {
    const t = m.replace(/[.,;:]+$/, "");
    const hasDigit = /\d/.test(t);
    const hasAlpha = /[A-Za-z]/.test(t);
    // Keep alphanumeric codes, or pure-digit asset numbers (>=3 digits).
    if ((hasDigit && hasAlpha && t.length >= 4) || (/^\d{3,}$/.test(t))) {
      out.add(t);
    }
  }
  return [...out];
}

// Detect an "area"/location phrase. We match against the org's real distinct
// area values so we never guess — only resolve to an area that actually exists.
function detectAreaPhrase(q: string, knownAreas: string[]): string | null {
  const s = q.toLowerCase();
  // Longest known area name that appears as a substring wins (most specific).
  const hits = knownAreas
    .filter((a) => a && s.includes(a.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  return hits[0] ?? null;
}

// ── Rendering ────────────────────────────────────────────────────────────

function renderAssetFailures(asset: Asset, wos: WorkOrder[]): string {
  const loc = [asset.site, asset.area, asset.line, asset.cell].filter(Boolean).join(" / ");
  const head = `ASSET ${asset.name}${asset.assetTag ? ` [${asset.assetTag}]` : ""}` +
    (loc ? ` — ${loc}` : "") +
    (asset.status ? ` (status: ${asset.status})` : "");

  const failures = wos.filter(isFailureWorkOrder).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 8);
  if (!failures.length) {
    return `${head}\n  No failure work orders on record for this asset.`;
  }
  const lines = failures.map((w) => {
    const bits: string[] = [];
    bits.push(`  - ${w.number ?? w.id} [${w.status}${w.priority ? `/${w.priority}` : ""}] ${dateStr(w.createdAt)}: ${w.title}`);
    if (w.symptom) bits.push(`      Symptom: ${w.symptom}`);
    if (w.rootCause) bits.push(`      Root cause: ${w.rootCause}`);
    if (w.failedPart) bits.push(`      Failed part: ${w.failedPart}`);
    if (w.repairAction) bits.push(`      Repair action: ${w.repairAction}`);
    else if (w.resolution) bits.push(`      Resolution: ${w.resolution}`);
    return bits.join("\n");
  });
  return `${head}\n${lines.join("\n")}`;
}

// ── Main entry ──────────────────────────────────────────────────────────────

export async function buildFailureLookupContext(
  orgId: string,
  question: string,
  opts: { selectedAssetId?: string | null } = {}
): Promise<FailureLookupResult> {
  if (!orgId) throw new Error("buildFailureLookupContext() requires orgId");
  const q = (question ?? "").trim();
  if (!q) return EMPTY;

  const sections: string[] = [];
  const matchedAssetIds = new Set<string>();
  const matchedPartIds = new Set<string>();

  // Pull the org's assets once; reuse for code-token, name, and area matching.
  const allAssets = await listAssets(orgId);
  const knownAreas = [...new Set(allAssets.map((a) => a.area).filter((a): a is string => Boolean(a)))];

  const codeTokens = extractCodeTokens(q);

  // 1) ASSET resolution — by asset tag / number / name / serial.
  const assetHits = new Map<string, Asset>();
  const lowerQ = q.toLowerCase();
  for (const a of allAssets) {
    const tag = (a.assetTag ?? "").toLowerCase();
    const serial = (a.serialNumber ?? "").toLowerCase();
    const name = (a.name ?? "").toLowerCase();
    const tokenMatch = codeTokens.some((t) => {
      const tl = t.toLowerCase();
      return (tag && (tag === tl || tag.includes(tl) || tl.includes(tag))) ||
        (serial && (serial === tl || serial.includes(tl)));
    });
    // Name match only when the asset name is a meaningful phrase present in Q.
    const nameMatch = name.length >= 3 && lowerQ.includes(name);
    if (tokenMatch || nameMatch) assetHits.set(a.id, a);
  }
  // If the UI already has an asset selected, include it too.
  if (opts.selectedAssetId) {
    const sel = allAssets.find((a) => a.id === opts.selectedAssetId);
    if (sel) assetHits.set(sel.id, sel);
  }

  // 2) AREA resolution — every asset in a matched area.
  const area = detectAreaPhrase(q, knownAreas);
  let areaAssets: Asset[] = [];
  if (area) {
    areaAssets = allAssets.filter((a) => (a.area ?? "").toLowerCase() === area.toLowerCase());
    for (const a of areaAssets) assetHits.set(a.id, a);
  }

  // Render asset failure histories (cap to keep the prompt bounded).
  const assetList = [...assetHits.values()].slice(0, 6);
  if (assetList.length) {
    const blocks: string[] = [];
    for (const a of assetList) {
      const wos = await listWorkOrders(orgId, { assetId: a.id });
      blocks.push(renderAssetFailures(a, wos));
      matchedAssetIds.add(a.id);
    }
    const header = area && areaAssets.length
      ? `FAILURES BY AREA — "${area}" (${areaAssets.length} asset(s) in this area):`
      : `FAILURES BY ASSET:`;
    sections.push(`${header}\n\n${blocks.join("\n\n")}`);
  }

  // 3) PART resolution — by part number, via the existing smart search; then its
  //    failure history (Field Memory). Only surface confident-enough matches.
  for (const token of codeTokens.slice(0, 3)) {
    const res = await smartSearch(orgId, token, 3);
    const match = res.bestMatch;
    if (match && (match.confidence === "high" || match.confidence === "medium")) {
      if (matchedPartIds.has(match.part.id)) continue;
      const fm = await getFieldMemory(orgId, match.part.id);
      if (!fm) continue;
      matchedPartIds.add(match.part.id);
      const p = fm.part;
      const lines: string[] = [];
      lines.push(
        `PART ${p.partNumber ?? p.id}${p.manufacturer ? ` (${p.manufacturer})` : ""} — ${p.description}`
      );
      lines.push(
        `  Recorded failures: ${fm.failure.failureCount}` +
          (fm.failure.lastFailedAt ? `, last failed ${dateStr(fm.failure.lastFailedAt)}` : "") +
          (fm.failure.avgDowntimeMins != null ? `, avg downtime ~${fm.failure.avgDowntimeMins} min` : "") +
          "."
      );
      if (fm.assets.length) {
        lines.push(
          `  Installed on: ${fm.assets
            .map((a) => `${a.name ?? a.assetId}${a.position ? ` (${a.position})` : ""}`)
            .join(", ")}.`
        );
      }
      const failWos = fm.workOrders.filter((w) => w.role === "failed").slice(0, 6);
      if (failWos.length) {
        lines.push("  Failure work orders:");
        for (const w of failWos) {
          lines.push(
            `    - ${w.number ?? w.workOrderId} [${w.status}]${w.closedAt ? ` ${dateStr(w.closedAt)}` : ""}: ${w.title}`
          );
        }
      }
      sections.push(lines.join("\n"));
    }
  }

  if (!sections.length) return EMPTY;

  const context =
    `The following are the plant's OWN structured maintenance records resolved ` +
    `from the question (by asset number, part number, and/or affected area). ` +
    `Treat these as authoritative facts and reference them directly:\n\n` +
    sections.join("\n\n────────\n\n");

  return {
    context,
    matched: true,
    matchedAssetIds: [...matchedAssetIds],
    matchedPartIds: [...matchedPartIds],
  };
}
