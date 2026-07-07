// ─────────────────────────────────────────────────────────────────────────
// Repeat-risk detection — chronic faults on a machine, derived ONLY from real
// closed corrective work orders. Shared by the Shift Handover digest and the
// manager Reliability Report so both use one reviewed implementation.
//
// Honesty rules: a bare number (480 V, 1200 rpm) is never treated as a fault
// code; shift/unit noise words never anchor a group; a "recurring fault" is only
// flagged at/above the threshold. Org-scoping is the caller's responsibility —
// the pure derive() takes already-org-scoped data; computeRepeatRisks() loads it.
// ─────────────────────────────────────────────────────────────────────────

import { listWorkOrders } from "@/lib/workorders/repository";
import { listAssets } from "@/lib/assets/repository";
import { listPrograms } from "@/lib/pm/repository";
import type { WorkOrder } from "@/lib/db/schema";

export const REPEAT_THRESHOLD = 3; // recurrences on one machine to call it chronic
export const REPEAT_WINDOW_DAYS = 90;

export interface RepeatRisk {
  assetId: string;
  assetName: string;
  label: string; // fault code / failed part / keyword
  count: number; // corrective closes on this machine in the window
  totalDowntimeMins: number;
  lastAt: number | null;
  // PM coverage for this machine: an active program breaks the cycle; a draft is
  // already proposed (awaiting approval); none is the callout to act on.
  pmState: "active" | "draft" | "none";
  sourceWorkOrderId: string; // most recent matching repair — seeds a Suggest-PM draft
}

const REPEAT_STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "was", "are", "not",
  "when", "then", "after", "again", "still", "into", "over", "machine", "fault",
  "issue", "problem", "error", "alarm", "failure", "failed", "down",
  // Shift/location/unit noise that must NEVER anchor a fault group on its own —
  // otherwise "line jam" + "line stopped" + "line fault" fabricate a "line ×3"
  // recurring fault where there is none.
  "line", "area", "cell", "zone", "side", "unit", "units", "time", "times",
  "today", "shift", "morning", "night", "week", "weekend", "hour", "hours",
  "minute", "minutes", "volts", "volt", "amps", "amp", "temp", "degrees", "rpm",
]);

// A stable key for "the same failure recurring" on a machine: a real fault code,
// then the failed part, then the leading significant keyword. A bare 3-4 digit
// number is deliberately NOT treated as a fault code — it is almost always a
// measurement (480 V, 1200 rpm, 150 psi), and grouping unrelated repairs by a
// coincidental number would invent a "recurring fault" from noise. A genuine
// fault code carries a letter prefix (F007, E12).
export function faultKeyOf(w: WorkOrder): string | null {
  const text = [w.title, w.symptom, w.rootCause, w.failedPart].filter(Boolean).join(" ");
  const code = text.match(/\b([a-z]\d{2,4})\b/i);
  if (code) return code[1].toUpperCase();
  const part = (w.failedPart ?? "").trim().toLowerCase();
  if (part) return part.replace(/\s+/g, " ").split(" ").slice(0, 3).join(" ");
  const kw = (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((k) => !REPEAT_STOP.has(k));
  return kw[0] ?? null;
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}

export interface DeriveOpts {
  windowDays?: number;
  now?: number;
  threshold?: number;
  limit?: number;
}

// Pure derivation from already-loaded, already-org-scoped data.
export function deriveRepeatRisks(
  workOrders: WorkOrder[],
  assetName: Map<string, string>,
  pms: { assetId: string | null; status: string }[],
  opts: DeriveOpts = {}
): RepeatRisk[] {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? REPEAT_WINDOW_DAYS;
  const threshold = opts.threshold ?? REPEAT_THRESHOLD;
  const limit = opts.limit ?? 6;
  const since = now - windowDays * 86400_000;

  const groups = new Map<string, { assetId: string; label: string; count: number; downtime: number; lastAt: number; sourceWoId: string }>();
  for (const w of workOrders) {
    if (w.type !== "corrective" || w.status !== "done" || !w.assetId) continue;
    const closed = ms(w.closedAt ?? w.updatedAt);
    if (closed < since) continue;
    const key = faultKeyOf(w);
    if (!key) continue;
    const gk = `${w.assetId}::${key}`;
    const g = groups.get(gk) ?? { assetId: w.assetId, label: key, count: 0, downtime: 0, lastAt: 0, sourceWoId: w.id };
    g.count++;
    g.downtime += Number(w.downtimeMins) || 0;
    if (closed >= g.lastAt) { g.lastAt = closed; g.sourceWoId = w.id; } // newest repair seeds the PM draft
    groups.set(gk, g);
  }

  const activePmAssets = new Set(pms.filter((p) => p.status === "active").map((p) => p.assetId).filter(Boolean));
  const draftPmAssets = new Set(pms.filter((p) => p.status === "draft").map((p) => p.assetId).filter(Boolean));

  return [...groups.values()]
    .filter((g) => g.count >= threshold)
    .map((g) => ({
      assetId: g.assetId,
      assetName: assetName.get(g.assetId) ?? "Unknown machine",
      label: g.label,
      count: g.count,
      totalDowntimeMins: g.downtime,
      lastAt: g.lastAt || null,
      pmState: (activePmAssets.has(g.assetId) ? "active" : draftPmAssets.has(g.assetId) ? "draft" : "none") as RepeatRisk["pmState"],
      sourceWorkOrderId: g.sourceWoId,
    }))
    .sort((a, b) => b.count - a.count || (b.lastAt ?? 0) - (a.lastAt ?? 0))
    .slice(0, limit);
}

// Convenience loader for callers that don't already have the data (the report).
export async function computeRepeatRisks(orgId: string, windowDays = REPEAT_WINDOW_DAYS, limit = 20): Promise<RepeatRisk[]> {
  if (!orgId) throw new Error("computeRepeatRisks() requires orgId");
  const [wos, assetRows, pms] = await Promise.all([
    listWorkOrders(orgId),
    listAssets(orgId),
    listPrograms(orgId),
  ]);
  const assetName = new Map(assetRows.map((a) => [a.id, a.name]));
  return deriveRepeatRisks(wos, assetName, pms, { windowDays, limit });
}
