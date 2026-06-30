import { db, ensureDb } from "@/lib/db";
import { parts, partAliases, partWorkOrderLinks, type Part } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────
// Parts search — normalizes a messy query, detects a likely manufacturer and
// category, and matches against the org's OWN parts + aliases with an HONEST
// confidence score and cited internal evidence. It never invents a part and
// never dresses a weak guess as a confident match (the result is flagged weak).
//
// This is a deterministic engine today; it is the single search isolation point
// so the scorer can later be swapped for embeddings/hybrid ranking with no
// change to callers or the API contract.
//
// Tenancy: orgId is required on every function — search only ever sees one org.
// ─────────────────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface SearchMatch {
  part: Part;
  confidence: Confidence;
  score: number;
  evidence: string[];
}

export interface PartsSearchResult {
  query: string;
  normalizedPartNumber: string;
  detectedManufacturer: string | null;
  inferredCategory: string | null;
  bestMatch: SearchMatch | null;
  matches: SearchMatch[];
  weak: boolean;
  note: string | null;
}

function normPN(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1);
}

// Manufacturer detection by well-known part-number patterns / brand keywords.
// Returns null unless there is real signal — we don't guess a brand.
function detectManufacturer(q: string): string | null {
  const s = q.toLowerCase();
  const pn = normPN(q).toLowerCase();
  if (/^25[ab]/.test(pn) || /powerflex|\bpf5\d{2}\b/.test(s)) return "Allen-Bradley";
  if (/^17(34|38|56|69|94)/.test(pn) || /controllogix|compactlogix|point\s?i\/?o/.test(s)) return "Allen-Bradley";
  if (/^871tm|^42[a-z]{2}/.test(pn) || /\bab\b|allen.?bradley|rockwell/.test(s)) return "Allen-Bradley";
  if (/^6(es7|sl3|av|ep)/.test(pn) || /siemens|sinamics|simatic/.test(s)) return "Siemens";
  if (/\bsick\b/.test(s)) return "SICK";
  if (/\bifm\b/.test(s)) return "ifm";
  if (/\bbanner\b/.test(s)) return "Banner";
  if (/\bomron\b/.test(s)) return "Omron";
  if (/\bskf\b/.test(s)) return "SKF";
  if (/\bfesto\b/.test(s)) return "Festo";
  if (/\bsmc\b/.test(s)) return "SMC";
  return null;
}

function inferCategory(q: string): string | null {
  const s = q.toLowerCase();
  const pn = normPN(q).toLowerCase();
  if (/bearing/.test(s) || /^6[0-9]{3}(2rs|zz|rs)?$/.test(pn)) return "Bearing";
  if (/photoeye|photo\s?eye|photoswitch|proximity|\bprox\b|sensor|^871tm/.test(s) || /^871tm/.test(pn)) return "Sensor";
  if (/powerflex|\bvfd\b|drive|inverter|^25[ab]/.test(s) || /^25[ab]/.test(pn)) return "VFD / Drive";
  if (/^17(34|56|69)/.test(pn) || /\bplc\b|i\/?o module/.test(s)) return "PLC / I/O";
  if (/contactor|relay|^100c/.test(pn) || /contactor|\brelay\b/.test(s)) return "Contactor / Relay";
  if (/\bmotor\b/.test(s)) return "Motor";
  if (/\bbelt\b/.test(s)) return "Belt";
  if (/\bvalve\b/.test(s)) return "Valve";
  return null;
}

export async function smartSearch(
  orgId: string,
  query: string,
  limit = 25
): Promise<PartsSearchResult> {
  if (!orgId) throw new Error("smartSearch() requires orgId");
  await ensureDb();
  const q = (query ?? "").trim();
  const normalizedPartNumber = normPN(q);
  const detectedManufacturer = detectManufacturer(q);
  const inferredCategory = inferCategory(q);

  const empty: PartsSearchResult = {
    query: q,
    normalizedPartNumber,
    detectedManufacturer,
    inferredCategory,
    bestMatch: null,
    matches: [],
    weak: true,
    note: null,
  };
  if (!q) return { ...empty, note: "Enter a part number, model, or description." };

  const [allParts, allAliases, woLinks] = await Promise.all([
    db.select().from(parts).where(eq(parts.orgId, orgId)),
    db.select().from(partAliases).where(eq(partAliases.orgId, orgId)),
    db.select().from(partWorkOrderLinks).where(eq(partWorkOrderLinks.orgId, orgId)),
  ]);

  const aliasByPart = new Map<string, { alias: string; norm: string }[]>();
  for (const a of allAliases) {
    const arr = aliasByPart.get(a.partId) ?? [];
    arr.push({ alias: a.alias, norm: normPN(a.alias) });
    aliasByPart.set(a.partId, arr);
  }
  const woCountByPart = new Map<string, number>();
  for (const l of woLinks) woCountByPart.set(l.partId, (woCountByPart.get(l.partId) ?? 0) + 1);

  const qTokens = tokens(q);
  const matches: SearchMatch[] = [];

  for (const p of allParts) {
    const evidence: string[] = [];
    let score = 0;
    let confidence: Confidence = "low";

    const pPN = normPN(p.partNumber ?? "");
    const pMPN = normPN(p.manufacturerPartNumber ?? "");

    // 1) Exact / contained part-number match (highest signal).
    if (normalizedPartNumber.length >= 3) {
      if (pPN === normalizedPartNumber || pMPN === normalizedPartNumber) {
        score += 100; confidence = "high"; evidence.push("Exact part-number match");
      } else if (
        (pPN && (pPN.includes(normalizedPartNumber) || normalizedPartNumber.includes(pPN))) ||
        (pMPN && (pMPN.includes(normalizedPartNumber) || normalizedPartNumber.includes(pMPN)))
      ) {
        score += 50; if (confidence === "low") confidence = "medium";
        evidence.push("Partial part-number match");
      }
    }

    // 2) Alias match.
    for (const a of aliasByPart.get(p.id) ?? []) {
      if (a.norm && (a.norm === normalizedPartNumber || a.norm.includes(normalizedPartNumber) || qTokens.includes(a.alias.toLowerCase()))) {
        score += 70; if (confidence !== "high") confidence = "high";
        evidence.push(`Matched via alias “${a.alias}”`);
        break;
      }
    }

    // 3) Manufacturer agreement.
    if (detectedManufacturer && (p.manufacturer ?? "").toLowerCase() === detectedManufacturer.toLowerCase()) {
      score += 8; evidence.push(`Manufacturer matches (${detectedManufacturer})`);
    }

    // 4) Category agreement.
    if (inferredCategory && (p.category ?? "").toLowerCase() === inferredCategory.toLowerCase()) {
      score += 6; evidence.push(`Category matches (${inferredCategory})`);
    }

    // 5) Description / free-text token overlap ("blue photoeye on conveyor 3").
    const hay = [p.description, p.category, p.manufacturer].filter(Boolean).join(" ").toLowerCase();
    const overlap = qTokens.filter((t) => hay.includes(t));
    if (overlap.length) {
      score += overlap.length * 4;
      if (confidence === "low" && overlap.length >= 2) confidence = "medium";
      evidence.push(`Text match on ${overlap.length} term${overlap.length > 1 ? "s" : ""}`);
    }

    // 6) Real-usage evidence: prior work orders mentioning this part.
    const woCount = woCountByPart.get(p.id) ?? 0;
    if (woCount > 0 && score > 0) {
      score += Math.min(woCount, 5);
      evidence.push(`Referenced by ${woCount} prior work order${woCount > 1 ? "s" : ""}`);
    }

    if (score > 0) matches.push({ part: p, score, confidence, evidence });
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, limit);
  const bestMatch = top[0] ?? null;
  const weak = !bestMatch || bestMatch.confidence === "low";

  let note: string | null = null;
  if (!bestMatch) {
    note = "No parts matched. Refine the search, or add this part to your catalog.";
  } else if (weak) {
    note = "No strong match — the closest results are low-confidence. Verify before ordering, or add the exact part.";
  }

  return { query: q, normalizedPartNumber, detectedManufacturer, inferredCategory, bestMatch, matches: top, weak, note };
}

export interface CompatibleMatch {
  part: Part;
  reasons: string[];
}

// Honest compatibility: real catalog parts that share the part's category and
// either its manufacturer or a cross-reference alias. No fabricated cross-refs.
export async function findCompatible(orgId: string, partId: string): Promise<CompatibleMatch[]> {
  if (!orgId) throw new Error("findCompatible() requires orgId");
  await ensureDb();
  const base = (await db.select().from(parts).where(and(eq(parts.orgId, orgId), eq(parts.id, partId))))[0];
  if (!base) return [];

  const [others, aliases] = await Promise.all([
    db.select().from(parts).where(eq(parts.orgId, orgId)),
    db.select().from(partAliases).where(eq(partAliases.orgId, orgId)),
  ]);
  const baseAliases = new Set(aliases.filter((a) => a.partId === partId).map((a) => normPN(a.alias)));
  baseAliases.add(normPN(base.partNumber ?? ""));
  baseAliases.add(normPN(base.manufacturerPartNumber ?? ""));

  const out: CompatibleMatch[] = [];
  for (const p of others) {
    if (p.id === partId) continue;
    const reasons: string[] = [];
    if (base.category && p.category && base.category.toLowerCase() === p.category.toLowerCase()) {
      reasons.push(`Same category (${p.category})`);
    }
    if (base.manufacturer && p.manufacturer && base.manufacturer.toLowerCase() === p.manufacturer.toLowerCase()) {
      reasons.push(`Same manufacturer (${p.manufacturer})`);
    }
    const pIds = [normPN(p.partNumber ?? ""), normPN(p.manufacturerPartNumber ?? "")];
    const pAliases = aliases.filter((a) => a.partId === p.id).map((a) => normPN(a.alias));
    if ([...pIds, ...pAliases].some((x) => x && baseAliases.has(x))) {
      reasons.push("Shares a cross-reference number");
    }
    // Require a real reason AND that it's the same category (don't suggest a
    // bearing as a replacement for a sensor just because the brand matches).
    if (reasons.length && reasons[0].startsWith("Same category")) out.push({ part: p, reasons });
  }
  return out;
}
