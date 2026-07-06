// ─────────────────────────────────────────────────────────────────────────
// Recurrence lookup — "have we seen this before?" answered from the plant's OWN
// closed corrective work orders, the instant a technician names a machine and a
// symptom. This is the machine-memory payoff made tangible: before touching a
// wrench, the tech sees the proven fix and what it cost last time.
//
// Deterministic and tenant-scoped. Matches a new free-text symptom against prior
// CLOSED CORRECTIVE work orders on the same asset by (a) a shared fault code and
// (b) significant-keyword overlap. Returns null when there's no real prior match,
// so the UI simply renders nothing (honest empty state — never invented).
// ─────────────────────────────────────────────────────────────────────────

import { listWorkOrders } from "@/lib/workorders/repository";
import type { WorkOrder } from "@/lib/db/schema";

export interface PriorFix {
  /** Number of prior closed corrective repairs that match this symptom. */
  count: number;
  /** Human label for the recurring problem — a fault code or a short phrase. */
  label: string;
  /** Summed captured downtime across the matching prior repairs (minutes). */
  totalDowntimeMins: number;
  /** The most recent matching repair — the proven fix to surface first. */
  last: {
    id: string;
    number: string | null;
    fix: string;
    failedPart: string | null;
    rootCause: string | null;
    downtimeMins: number | null;
    at: number | null;
  } | null;
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}

// A fault code: a letter + 2-4 digits (F007, E12) or a bare 3-4 digit code.
// Deliberately narrow so "20 minutes" / "line 2" don't read as codes.
function faultCode(s: string): string | null {
  const m = s.match(/\b([a-z]\d{2,4}|\d{3,4})\b/i);
  return m ? m[1].toUpperCase() : null;
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "has", "was", "are", "not",
  "but", "get", "got", "when", "then", "keeps", "keep", "after", "about", "minutes",
  "minute", "machine", "again", "still", "into", "over", "runs", "run", "running",
  "start", "startup", "started", "goes", "went", "have", "having", "some", "onto",
]);

// Significant lowercase word tokens (>=4 alpha chars, not a stopword).
function keywords(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of (s.toLowerCase().match(/[a-z]{4,}/g) ?? [])) {
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

function priorText(w: WorkOrder): string {
  return [w.title, w.symptom, w.rootCause, w.failedPart, w.repairAction, w.resolution]
    .filter(Boolean)
    .join(" ");
}

// Find prior proven fixes for a new symptom on a given asset. Requires an asset
// (the recurrence story is per-machine) OR a fault code for an org-wide code match.
export async function findPriorFixes(
  orgId: string,
  input: { assetId?: string | null; symptom?: string | null }
): Promise<PriorFix | null> {
  if (!orgId) throw new Error("findPriorFixes() requires orgId");
  const symptom = (input.symptom ?? "").trim();
  if (!symptom) return null;
  if (!input.assetId && !faultCode(symptom)) return null; // too little signal

  // Candidates: closed corrective repairs on this asset (or org-wide when no asset
  // but we have a fault code to anchor on).
  const candidates = await listWorkOrders(orgId, {
    status: "done",
    type: "corrective",
    ...(input.assetId ? { assetId: input.assetId } : {}),
  });
  if (!candidates.length) return null;

  const newCode = faultCode(symptom);
  const newKw = keywords(symptom);

  const scored = candidates
    .map((w) => {
      const text = priorText(w);
      const codeMatch = newCode ? new RegExp(`\\b${newCode}\\b`, "i").test(text) : false;
      let overlap = 0;
      const kw = keywords(text);
      for (const k of newKw) if (kw.has(k)) overlap++;
      // Match on a shared fault code, or on >=2 shared significant keywords.
      const score = (codeMatch ? 3 : 0) + overlap;
      const matched = codeMatch || overlap >= 2;
      return { w, score, matched };
    })
    .filter((c) => c.matched)
    .sort((a, b) => b.score - a.score || ms(b.w.closedAt ?? b.w.createdAt) - ms(a.w.closedAt ?? a.w.createdAt));

  if (!scored.length) return null;

  const matches = scored.map((s) => s.w);
  const totalDowntimeMins = matches.reduce((sum, w) => sum + (Number(w.downtimeMins) || 0), 0);
  // Most recent matching repair drives the headline "last fix".
  const last = [...matches].sort((a, b) => ms(b.closedAt ?? b.createdAt) - ms(a.closedAt ?? a.createdAt))[0];
  const fix =
    (last.repairAction || last.failedPart || last.rootCause || last.resolution || last.title || "").trim();

  // Label the recurrence: the shared fault code, else the top keyword, else a phrase.
  const label = newCode ?? [...newKw][0] ?? symptom.slice(0, 40);

  return {
    count: matches.length,
    label,
    totalDowntimeMins,
    last: {
      id: last.id,
      number: last.number ?? null,
      fix,
      failedPart: last.failedPart ?? null,
      rootCause: last.rootCause ?? null,
      downtimeMins: last.downtimeMins ?? null,
      at: ms(last.closedAt ?? last.createdAt) || null,
    },
  };
}
