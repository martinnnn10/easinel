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
import type { WorkOrder } from "@/lib/db/schema";

const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

// Repeat-risk tuning: a fault that recurred this many times on the same machine
// within the window is "chronic" and worth flagging at handover.
const REPEAT_THRESHOLD = 3;
const REPEAT_WINDOW_DAYS = 90;

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
function faultKeyOf(w: WorkOrder): string | null {
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

// A machine with a fault that keeps coming back — the chronic problem the day
// shift firefights but never fixes. Surfaced so the next shift (and the manager)
// sees it, and whether a PM is already in place to break the cycle.
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

  // ── Repeat risks — chronic faults, from real closed corrective work ──────────
  // Group closed corrective repairs by machine + fault key over the window; a
  // group at/above the threshold is a recurring problem. Flag whether the machine
  // already has an active PM, so the callout is "recurring AND unprevented".
  const repeatSince = now - REPEAT_WINDOW_DAYS * 86400_000;
  const groups = new Map<string, { assetId: string; label: string; count: number; downtime: number; lastAt: number; sourceWoId: string }>();
  for (const w of all) {
    if (w.type !== "corrective" || w.status !== "done" || !w.assetId) continue;
    const closed = ms(w.closedAt ?? w.updatedAt);
    if (closed < repeatSince) continue;
    const key = faultKeyOf(w);
    if (!key) continue;
    const gk = `${w.assetId}::${key}`;
    const g = groups.get(gk) ?? { assetId: w.assetId, label: key, count: 0, downtime: 0, lastAt: 0, sourceWoId: w.id };
    g.count++;
    g.downtime += Number(w.downtimeMins) || 0;
    if (closed >= g.lastAt) { g.lastAt = closed; g.sourceWoId = w.id; } // newest repair seeds the PM draft
    groups.set(gk, g);
  }
  const activePmAssets = new Set(allPms.filter((p) => p.status === "active").map((p) => p.assetId).filter(Boolean));
  const draftPmAssets = new Set(allPms.filter((p) => p.status === "draft").map((p) => p.assetId).filter(Boolean));
  const repeatRisks: RepeatRisk[] = [...groups.values()]
    .filter((g) => g.count >= REPEAT_THRESHOLD)
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
    .slice(0, 6);

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
