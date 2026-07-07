// ─────────────────────────────────────────────────────────────────────────
// Shift-Handover Digest — an end-of-shift briefing generated from REAL data:
// machines down, open/in-progress work, what closed this shift, requests
// awaiting approval, and PMs due. Pure aggregation over existing repositories —
// nothing invented. The next shift walks in knowing exactly what to watch.
// Org-scoped throughout.
// ─────────────────────────────────────────────────────────────────────────

import { listWorkOrders, workOrderStats, countPendingRequests } from "@/lib/workorders/repository";
import { listAssets } from "@/lib/assets/repository";
import { listDue, listPrograms } from "@/lib/pm/repository";
import { deriveRepeatRisks, REPEAT_WINDOW_DAYS, type RepeatRisk } from "@/lib/reliability/repeatRisks";
import type { WorkOrder } from "@/lib/db/schema";

export type { RepeatRisk };

const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}
function timeStr(v: unknown): string {
  const n = ms(v);
  return n ? new Date(n).toISOString().slice(11, 16) : "—";
}

export interface HandoverLine {
  id: string;
  number: string | null;
  title: string;
  priority: string;
  status: string;
  assetId: string | null;
  downtimeMins?: number | null;
  closedAt?: number | null;
}

// RepeatRisk is defined in and re-exported from @/lib/reliability/repeatRisks
// (shared with the Reliability Report).

export interface HandoverDigest {
  generatedAt: number;
  windowHours: number;
  stats: { open: number; inProgress: number; onHold: number; closedThisShift: number; pendingRequests: number; pmsDue: number; repeatRisks: number };
  machinesDown: { id: string; name: string; assetTag: string | null }[];
  active: HandoverLine[]; // open + in_progress, priority-sorted
  onHold: HandoverLine[];
  closedThisShift: HandoverLine[];
  pmsDue: { id: string; title: string; assetId: string | null }[];
  repeatRisks: RepeatRisk[];
  watchItems: string[];
  markdown: string;
}

function toLine(w: WorkOrder): HandoverLine {
  return {
    id: w.id,
    number: w.number ?? null,
    title: w.title,
    priority: w.priority,
    status: w.status,
    assetId: w.assetId ?? null,
    downtimeMins: w.downtimeMins ?? null,
    closedAt: w.closedAt ? ms(w.closedAt) : null,
  };
}

export async function generateHandover(orgId: string, windowHours = 12, now = Date.now()): Promise<HandoverDigest> {
  if (!orgId) throw new Error("generateHandover() requires orgId");
  const since = now - windowHours * 3600_000;

  const [all, stats, pendingRequests, allAssets, pmsDueRaw, allPms] = await Promise.all([
    listWorkOrders(orgId),
    workOrderStats(orgId),
    countPendingRequests(orgId),
    listAssets(orgId),
    listDue(orgId),
    listPrograms(orgId),
  ]);
  const assetsDown = allAssets.filter((a) => a.status === "down");
  const assetName = new Map(allAssets.map((a) => [a.id, a.name]));

  const bySeverity = (a: WorkOrder, b: WorkOrder) =>
    (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) || ms(b.createdAt) - ms(a.createdAt);

  const active = all
    .filter((w) => w.status === "open" || w.status === "in_progress")
    .sort(bySeverity)
    .map(toLine);
  const onHold = all.filter((w) => w.status === "on_hold").sort(bySeverity).map(toLine);
  const closedThisShift = all
    .filter((w) => w.status === "done" && w.closedAt && ms(w.closedAt) >= since)
    .sort((a, b) => ms(b.closedAt) - ms(a.closedAt))
    .map(toLine);

  const machinesDown = assetsDown.map((a) => ({ id: a.id, name: a.name, assetTag: a.assetTag ?? null }));
  const pmsDue = pmsDueRaw.map((p) => ({ id: p.id, title: p.title, assetId: p.assetId ?? null }));

  // Repeat risks — chronic faults over a 90-day window, from real closed
  // corrective work, flagged with PM coverage. Shared with the Reliability Report.
  const repeatRisks: RepeatRisk[] = deriveRepeatRisks(all, assetName, allPms, {
    now,
    windowDays: REPEAT_WINDOW_DAYS,
    limit: 6,
  });

  // Watch items — the few things the next shift must not miss.
  const watchItems: string[] = [];
  const urgent = active.filter((w) => w.priority === "urgent" || w.priority === "high");
  if (machinesDown.length) watchItems.push(`${machinesDown.length} machine(s) currently DOWN: ${machinesDown.map((m) => m.name).join(", ")}.`);
  if (urgent.length) watchItems.push(`${urgent.length} high/urgent work order(s) still open.`);
  if (onHold.length) watchItems.push(`${onHold.length} work order(s) on hold — confirm what's blocking them.`);
  if (pendingRequests > 0) watchItems.push(`${pendingRequests} maintenance request(s) awaiting approval.`);
  if (pmsDue.length) watchItems.push(`${pmsDue.length} preventive task(s) due.`);
  const uncoveredRepeats = repeatRisks.filter((r) => r.pmState === "none");
  if (uncoveredRepeats.length) {
    watchItems.push(
      `${uncoveredRepeats.length} machine(s) with a recurring fault and no PM in place: ${uncoveredRepeats
        .slice(0, 2)
        .map((r) => `${r.assetName} (${r.label} ×${r.count})`)
        .join(", ")}.`
    );
  }
  if (!watchItems.length) watchItems.push("No open critical items — quiet board at handover.");

  const line = (w: HandoverLine) =>
    `- ${w.number ?? w.id} [${w.priority}] ${w.title}${w.status === "in_progress" ? " (in progress)" : ""}`;

  const date = new Date(now);
  const markdown = [
    `# Shift Handover — ${date.toISOString().slice(0, 16).replace("T", " ")}`,
    `Window: last ${windowHours}h. Board: ${stats.open} open · ${stats.inProgress} in progress · ${stats.onHold} on hold.`,
    ``,
    `## ⚠ Watch items`,
    ...watchItems.map((w) => `- ${w}`),
    ``,
    `## 🔴 Machines down (${machinesDown.length})`,
    ...(machinesDown.length ? machinesDown.map((m) => `- ${m.name}${m.assetTag ? ` [${m.assetTag}]` : ""}`) : ["- None."]),
    ``,
    `## 🔧 Active work — open & in progress (${active.length})`,
    ...(active.length ? active.slice(0, 25).map(line) : ["- None."]),
    ...(onHold.length ? ["", `## ⏸ On hold (${onHold.length})`, ...onHold.map(line)] : []),
    ``,
    `## ✅ Closed this shift (${closedThisShift.length})`,
    ...(closedThisShift.length
      ? closedThisShift.slice(0, 25).map((w) => `- ${w.number ?? w.id} ${w.title}${w.downtimeMins != null ? ` — ${w.downtimeMins} min downtime` : ""} (closed ${timeStr(w.closedAt)})`)
      : ["- None this shift."]),
    ``,
    `## 🔁 Repeat risks — recurring faults, last ${REPEAT_WINDOW_DAYS}d (${repeatRisks.length})`,
    ...(repeatRisks.length
      ? repeatRisks.map(
          (r) =>
            `- ${r.assetName}: ${r.label} — ${r.count}× ${
              r.totalDowntimeMins ? `, ${Math.round((r.totalDowntimeMins / 60) * 10) / 10}h downtime` : ""
            }${r.pmState === "active" ? " (PM in place)" : r.pmState === "draft" ? " (PM drafted)" : " — no PM yet"}`
        )
      : ["- None — no fault has recurred enough to flag."]),
    ``,
    `## 📋 Preventive tasks due (${pmsDue.length})`,
    ...(pmsDue.length ? pmsDue.slice(0, 25).map((p) => `- ${p.title}`) : ["- None due."]),
    ``,
    `## 📥 Awaiting approval`,
    `- ${pendingRequests} maintenance request(s) pending.`,
  ].join("\n");

  return {
    generatedAt: now,
    windowHours,
    stats: {
      open: stats.open,
      inProgress: stats.inProgress,
      onHold: stats.onHold,
      closedThisShift: closedThisShift.length,
      pendingRequests,
      pmsDue: pmsDue.length,
      repeatRisks: repeatRisks.length,
    },
    machinesDown,
    active,
    onHold,
    closedThisShift,
    pmsDue,
    repeatRisks,
    watchItems,
    markdown,
  };
}
