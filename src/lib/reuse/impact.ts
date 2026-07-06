/**
 * Knowledge Reuse Impact — the read/measure side. Aggregates the append-only
 * reuse_events and computes, from REAL work orders only, whether reused
 * knowledge was associated with less downtime than prior same-fault events on
 * the same machine.
 *
 * Honesty rules (hard):
 *   - Avoided downtime is shown ONLY when there are enough prior comparable
 *     events to form an honest baseline (>= MIN_PRIORS). Otherwise it is null
 *     and the UI says "Not enough history yet to calculate avoided downtime."
 *   - Dollars appear ONLY when the org has set a real downtime cost rate.
 *   - Nothing is invented, defaulted, or averaged from other plants.
 */

import { db, ensureDb } from "@/lib/db";
import { reuseEvents, users, workOrders, assets, orgs } from "@/lib/db/schema";
import { and, eq, gte } from "drizzle-orm";

const MIN_PRIORS = 2; // need at least this many prior same-fault events to compare

export interface ReusedFix {
  sourceId: string;
  label: string;
  assetName: string | null;
  timesSurfaced: number;
  timesUsed: number;
  originalAuthor: string | null;
}

export interface ReuseImpact {
  periodDays: number;
  repeatsCaughtAtIntake: number; // WOs where prior knowledge existed at intake
  workOrdersAssisted: number; // WOs closed after prior knowledge surfaced
  mostReusedFixes: ReusedFix[];
  topReusers: { name: string; count: number }[];
  // Impact — null until the evidence supports it.
  comparableWorkOrders: number;
  avoidedDowntimeHours: number | null;
  avoidedDowntimeCost: number | null;
  downtimeCostPerHour: number | null;
  pmsFromRepeats: number;
  hasData: boolean;
  hasEnoughForSavings: boolean;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}
// Does a prior WO's text carry the same fault label? Codes match on a word
// boundary; keyword labels match as a contained token.
function matchesLabel(text: string, label: string): boolean {
  if (!label) return false;
  const t = text.toLowerCase();
  const l = label.toLowerCase();
  if (/^[a-z]?\d{2,4}$/i.test(label)) return new RegExp(`\\b${l}\\b`).test(t);
  return t.includes(l);
}
function woText(w: typeof workOrders.$inferSelect): string {
  return [w.title, w.symptom, w.rootCause, w.failedPart, w.repairAction, w.resolution]
    .filter(Boolean).join(" ");
}

export async function getReuseImpact(orgId: string, periodDays = 90): Promise<ReuseImpact> {
  if (!orgId) throw new Error("getReuseImpact() requires orgId");
  await ensureDb();
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const [events, members, wos, assetRows, orgRow] = await Promise.all([
    db.select().from(reuseEvents).where(and(eq(reuseEvents.orgId, orgId), gte(reuseEvents.at, periodStart))),
    db.select().from(users).where(eq(users.orgId, orgId)),
    db.select().from(workOrders).where(eq(workOrders.orgId, orgId)),
    db.select({ id: assets.id, name: assets.name }).from(assets).where(eq(assets.orgId, orgId)),
    db.select().from(orgs).where(eq(orgs.id, orgId)).then((r) => r[0]),
  ]);

  // Resolve an actor string (id OR email) to a display name.
  const byId = new Map(members.map((u) => [u.id, u]));
  const byEmail = new Map(members.map((u) => [u.email.toLowerCase(), u]));
  const nameOf = (actor: string | null) => {
    if (!actor) return null;
    const u = byId.get(actor) ?? byEmail.get(actor.toLowerCase());
    return u?.name ?? null;
  };
  const assetName = new Map(assetRows.map((a) => [a.id, a.name]));
  const woById = new Map(wos.map((w) => [w.id, w]));

  const surfaced = events.filter((e) => e.eventType === "prior_fix_surfaced");
  const used = events.filter((e) => e.eventType === "prior_fix_used_in_closeout");
  const pmsFromRepeats = events.filter((e) => e.eventType === "pm_created_from_failure").length;

  const repeatsCaughtAtIntake = new Set(surfaced.map((e) => e.workOrderId)).size;
  const workOrdersAssisted = new Set(used.map((e) => e.workOrderId)).size;

  // Most-reused fixes: group by the prior source, count surfaced/used.
  const bySource = new Map<string, ReusedFix>();
  for (const e of surfaced) {
    if (!e.sourceId) continue;
    const f = bySource.get(e.sourceId) ?? {
      sourceId: e.sourceId, label: e.label ?? "—",
      assetName: e.assetId ? assetName.get(e.assetId) ?? null : null,
      timesSurfaced: 0, timesUsed: 0, originalAuthor: nameOf(e.originalAuthorUserId),
    };
    f.timesSurfaced++;
    bySource.set(e.sourceId, f);
  }
  for (const e of used) {
    if (!e.sourceId) continue;
    const f = bySource.get(e.sourceId);
    if (f) f.timesUsed++;
  }
  const mostReusedFixes = [...bySource.values()]
    .sort((a, b) => (b.timesUsed - a.timesUsed) || (b.timesSurfaced - a.timesSurfaced))
    .slice(0, 8);

  // Top reusers — technicians who closed WOs with prior knowledge in hand.
  const reuserCount = new Map<string, number>();
  for (const e of used) {
    const n = nameOf(e.surfacedToUserId);
    if (n) reuserCount.set(n, (reuserCount.get(n) ?? 0) + 1);
  }
  const topReusers = [...reuserCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ── Avoided downtime — honest comparison only ────────────────────────────
  // For each assisted WO, compare its downtime to the median of PRIOR same-fault
  // closed WOs on the same asset. Count only when there are >= MIN_PRIORS priors
  // AND this WO beat the median.
  let avoidedMins = 0;
  let comparableWorkOrders = 0;
  const seenAssisted = new Set<string>();
  for (const e of used) {
    if (!e.workOrderId || seenAssisted.has(e.workOrderId)) continue;
    seenAssisted.add(e.workOrderId);
    const w = woById.get(e.workOrderId);
    if (!w || !w.assetId || !e.label) continue;
    const thisDown = Number(w.downtimeMins) || 0;
    if (thisDown <= 0) continue;
    const closedAt = ms(w.closedAt ?? w.updatedAt);
    const priors = wos
      .filter((p) =>
        p.id !== w.id &&
        p.assetId === w.assetId &&
        p.type === "corrective" &&
        p.status === "done" &&
        Number(p.downtimeMins) > 0 &&
        ms(p.closedAt ?? p.updatedAt) < closedAt &&
        matchesLabel(woText(p), e.label!)
      )
      .map((p) => Number(p.downtimeMins));
    if (priors.length < MIN_PRIORS) continue; // not enough history — stay honest
    const base = median(priors);
    comparableWorkOrders++;
    if (thisDown < base) avoidedMins += base - thisDown;
  }

  const downtimeCostPerHour =
    orgRow?.downtimeCostPerHour != null && orgRow.downtimeCostPerHour > 0 ? orgRow.downtimeCostPerHour : null;
  const hasEnoughForSavings = comparableWorkOrders > 0;
  const avoidedDowntimeHours = hasEnoughForSavings ? Math.round((avoidedMins / 60) * 10) / 10 : null;
  const avoidedDowntimeCost =
    avoidedDowntimeHours != null && downtimeCostPerHour != null
      ? Math.round(avoidedDowntimeHours * downtimeCostPerHour)
      : null;

  return {
    periodDays,
    repeatsCaughtAtIntake,
    workOrdersAssisted,
    mostReusedFixes,
    topReusers,
    comparableWorkOrders,
    avoidedDowntimeHours,
    avoidedDowntimeCost,
    downtimeCostPerHour,
    pmsFromRepeats,
    hasData: surfaced.length > 0 || used.length > 0,
    hasEnoughForSavings,
  };
}
