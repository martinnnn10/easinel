/**
 * Pilot value summary — the buyer/exec view of what EAS has actually done for
 * this organization, computed ENTIRELY from the org's own real records. No
 * fabricated savings, no industry averages, no seeded data. Every number is
 * traceable to work orders, documents, and PMs the customer's own team created.
 *
 * The story it tells, in order of what closes a pilot:
 *   1. Machine memory captured — knowledge that would otherwise walk out the door
 *   2. Recurring failures surfaced — where the money is leaking, ranked by impact
 *   3. Downtime impact — hours and (once a rate is set) dollars, vs the prior period
 *   4. Response + discipline — MTTR and PM compliance
 *   5. Knowledge grounded — the searchable plant library backing the Copilot
 *
 * Honest empty states are the caller's job: every field is null/0/[] until the
 * underlying real activity exists, and the coverage flags say what's missing.
 */

import { db, ensureDb } from "@/lib/db";
import { workOrders, documents, assets } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { calculateKpis, type KpiSummary } from "./metrics";

// Narrow fault-code detector — letter-prefixed codes (F007, E12) or 3–4 bare
// digits. Deliberately NOT bare 2-digit numbers, so "Line 12" / "~20 min" never
// fabricate a fault group. Mirrors recurrence.ts / the Failures tab.
function faultCode(s: string): string | null {
  const m = s.match(/\b([a-z]\d{2,4}|\d{3,4})\b/i);
  return m ? m[1].toUpperCase() : null;
}

const STOP = new Set(["the", "and", "for", "with", "was", "not", "has", "had", "after", "before", "when", "then", "this", "that", "keeps", "again"]);
function keywords(s: string): string[] {
  return Array.from(
    new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)))
  );
}

// A fault signature groups a machine's failures that are "the same problem":
// prefer an explicit fault code; otherwise fall back to the dominant keyword.
function signature(symptom: string, title: string): string | null {
  const text = `${symptom} ${title}`.trim();
  const code = faultCode(text);
  if (code) return `code:${code}`;
  const kw = keywords(text);
  return kw.length ? `kw:${kw[0]}` : null;
}

export interface RepeatFailure {
  assetId: string | null;
  assetName: string | null;
  label: string; // e.g. "F007" or "overload"
  count: number;
  downtimeHours: number;
  downtimeCost: number | null;
}

export interface PilotValue {
  periodDays: number;
  // Shared operational KPIs (downtime $/hours/delta, MTTR, PM compliance).
  kpis: KpiSummary;

  // 1) Machine memory captured — corrective closes with real captured knowledge.
  capturedFixesPeriod: number;
  capturedFixesAllTime: number;
  lessonsIndexed: number; // lesson/RCA documents

  // 2) Recurring failures surfaced.
  recurringCount: number;
  recurringDowntimeHours: number;
  recurringDowntimeCost: number | null;
  topRepeatFailures: RepeatFailure[];

  // 5) Knowledge grounded.
  documentsIndexed: number;

  // Volume context.
  totalWorkOrders: number;
  closedWorkOrders: number;

  // Honest coverage flags — the UI shows a "still building" state when false.
  hasMemory: boolean;
  hasRecurring: boolean;
  hasDowntime: boolean;
}

export async function calculatePilotValue(orgId: string, periodDays = 90): Promise<PilotValue> {
  if (!orgId) throw new Error("calculatePilotValue() requires orgId");
  await ensureDb();

  const kpis = await calculateKpis(orgId, periodDays);
  const rate = kpis.downtimeCostPerHour; // null until an admin sets it
  const now = Date.now();
  const periodStart = now - periodDays * 24 * 60 * 60 * 1000;

  const allWOs = await db.select().from(workOrders).where(eq(workOrders.orgId, orgId));

  const hasKnowledge = (w: typeof allWOs[number]) =>
    !!(w.resolution?.trim() || w.rootCause?.trim() || w.repairAction?.trim());
  const closedCorrective = allWOs.filter((w) => w.status === "done" && w.type === "corrective");
  const capturedAll = closedCorrective.filter(hasKnowledge);
  const capturedFixesAllTime = capturedAll.length;
  const capturedFixesPeriod = capturedAll.filter(
    (w) => (w.closedAt ? w.closedAt.getTime() : w.createdAt.getTime()) >= periodStart
  ).length;

  // ── Recurring failures: cluster corrective WOs by asset + fault signature ──
  const clusters = new Map<string, { assetId: string | null; label: string; wos: typeof allWOs }>();
  for (const w of allWOs) {
    if (w.type !== "corrective" || !w.assetId) continue;
    const sig = signature(w.symptom ?? "", w.title ?? "");
    if (!sig) continue;
    const key = `${w.assetId}::${sig}`;
    const label = sig.startsWith("code:") ? sig.slice(5) : sig.slice(3);
    const c = clusters.get(key) ?? { assetId: w.assetId, label, wos: [] as typeof allWOs };
    c.wos.push(w);
    clusters.set(key, c);
  }

  // Resolve asset names once for the clusters we'll surface.
  const assetRows = await db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(eq(assets.orgId, orgId));
  const assetName = new Map(assetRows.map((a) => [a.id, a.name]));

  const repeats: RepeatFailure[] = [];
  for (const c of clusters.values()) {
    if (c.wos.length < 2) continue; // a recurrence needs ≥2 events
    const mins = c.wos.reduce((s, w) => s + (w.downtimeMins || 0), 0);
    const hours = Math.round((mins / 60) * 10) / 10;
    repeats.push({
      assetId: c.assetId,
      assetName: c.assetId ? assetName.get(c.assetId) ?? null : null,
      label: c.label,
      count: c.wos.length,
      downtimeHours: hours,
      downtimeCost: rate != null ? Math.round(hours * rate) : null,
    });
  }
  repeats.sort((a, b) => b.downtimeHours - a.downtimeHours || b.count - a.count);

  const recurringCount = repeats.length;
  const recurringDowntimeHours = Math.round(repeats.reduce((s, r) => s + r.downtimeHours, 0) * 10) / 10;
  const recurringDowntimeCost = rate != null ? Math.round(recurringDowntimeHours * rate) : null;

  // ── Knowledge grounded: indexed, non-archived documents (their searchable
  // plant library). Lessons/RCA are the memory EAS itself generated on close. ──
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), isNull(documents.archivedAt)));
  const documentsIndexed = docs.filter((d) => (d.charCount ?? 0) > 0).length;
  const lessonsIndexed = docs.filter((d) => d.kind === "lesson" || d.kind === "rca").length;

  return {
    periodDays,
    kpis,
    capturedFixesPeriod,
    capturedFixesAllTime,
    lessonsIndexed,
    recurringCount,
    recurringDowntimeHours,
    recurringDowntimeCost,
    topRepeatFailures: repeats.slice(0, 5),
    documentsIndexed,
    totalWorkOrders: allWOs.length,
    closedWorkOrders: allWOs.filter((w) => w.status === "done").length,
    hasMemory: capturedFixesAllTime > 0,
    hasRecurring: recurringCount > 0,
    hasDowntime: kpis.downtimeHours > 0,
  };
}
