import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { generateHandover } from "@/lib/handover/generate";
import { listWorkOrders } from "@/lib/workorders/repository";
import { listAssets } from "@/lib/assets/repository";
import { listHandoverNotes } from "@/lib/handover/notes";
import { listSessions } from "@/lib/queries";
import { rcaStatusByWorkOrder } from "@/lib/rca/repository";
import { classifyAssetClass, classifyFailureType, rcaBoardState } from "@/lib/today/classify";

export const runtime = "nodejs";

const ms = (x: unknown): number => (x instanceof Date ? x.getTime() : typeof x === "number" ? x : 0);

// GET /api/today — the daily maintenance COMMAND BOARD. Enriches each work item
// with its machine context (name, line/area, class, criticality), an inferred
// failure type, how long it's been open/down, its RCA state, and next actions.
// Org-scoped; reuses existing repositories. Real data only — no seeded examples.
export const GET = safeHandler("today.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const now = Date.now();

  const [digest, openWos, closedWos, notes, sessions, assetRows] = await Promise.all([
    generateHandover(orgId, 24),
    listWorkOrders(orgId, { status: "open" }),
    listWorkOrders(orgId, { status: "done" }),
    listHandoverNotes(orgId, 24),
    listSessions(orgId, 5),
    listAssets(orgId),
  ]);

  // Asset context map — retired machines are excluded from the working board.
  const assetById = new Map(assetRows.filter((a) => a.status !== "retired").map((a) => [a.id, a]));
  const ctx = (assetId: string | null | undefined) => {
    const a = assetId ? assetById.get(assetId) : undefined;
    if (!a) return null;
    return {
      assetId: a.id,
      assetName: a.name,
      line: a.line ?? a.area ?? null,
      area: a.area ?? null,
      assetClass: classifyAssetClass({ name: a.name, model: a.model, assetType: a.assetType }),
      criticality: a.criticality ?? "medium",
    };
  };

  const rank = (p: string) => ({ urgent: 0, high: 1, medium: 2, low: 3 }[p] ?? 4);
  const topOpen = [...openWos].sort((a, b) => rank(a.priority) - rank(b.priority)).slice(0, 6);

  // RCA status for every work order we might badge.
  const woIds = new Set<string>();
  topOpen.forEach((w) => woIds.add(w.id));
  closedWos.slice(0, 20).forEach((w) => woIds.add(w.id));
  const rcaMap = await rcaStatusByWorkOrder(orgId, [...woIds]);
  const rcaState = (id: string, type: string, downtime: number | null) =>
    rcaBoardState(rcaMap.get(id), type, downtime);

  const openMinsOf = (w: { reportedAt?: unknown; createdAt?: unknown }) =>
    Math.max(0, Math.round((now - (ms(w.reportedAt) || ms(w.createdAt))) / 60000));

  const openCritical = topOpen.map((w) => ({
    id: w.id,
    number: w.number,
    title: w.title,
    symptom: w.symptom ?? null,
    priority: w.priority,
    status: w.status,
    type: w.type,
    openMins: openMinsOf(w),
    failureType: classifyFailureType([w.title, w.symptom, w.failedPart, w.rootCause].filter(Boolean).join(" ")),
    rcaStatus: rcaState(w.id, w.type, w.downtimeMins ?? null),
    asset: ctx(w.assetId),
  }));

  // Machines down — enrich each down asset with its latest open work order.
  const openByAsset = new Map<string, typeof openWos>();
  for (const w of openWos) {
    if (!w.assetId) continue;
    const arr = openByAsset.get(w.assetId) ?? [];
    arr.push(w);
    openByAsset.set(w.assetId, arr);
  }
  const machinesDown = digest.machinesDown
    .filter((m) => assetById.has(m.id)) // never a retired machine
    .map((m) => {
      const a = assetById.get(m.id)!;
      const w = (openByAsset.get(m.id) ?? []).sort((x, y) => rank(x.priority) - rank(y.priority))[0];
      return {
        assetId: m.id,
        name: a.name,
        line: a.line ?? a.area ?? null,
        assetClass: classifyAssetClass({ name: a.name, model: a.model, assetType: a.assetType }),
        criticality: a.criticality ?? "medium",
        wo: w
          ? {
              id: w.id,
              number: w.number,
              title: w.title,
              symptom: w.symptom ?? null,
              openMins: openMinsOf(w),
              failureType: classifyFailureType([w.title, w.symptom, w.failedPart].filter(Boolean).join(" ")),
            }
          : null,
      };
    });

  const recentClosed = [...closedWos]
    .sort((a, b) => ms(b.closedAt ?? b.updatedAt) - ms(a.closedAt ?? a.updatedAt))
    .slice(0, 5)
    .map((w) => ({
      id: w.id,
      number: w.number,
      title: w.title,
      closedAt: ms(w.closedAt ?? w.updatedAt) || null,
      assetName: ctx(w.assetId)?.assetName ?? null,
      rcaStatus: rcaState(w.id, w.type, w.downtimeMins ?? null),
    }));

  const recentSessions = sessions.slice(0, 5).map((s) => ({
    id: s.id,
    title: s.title,
    updatedAt: s.updatedAt,
    assetName: s.assetName ?? null,
    failureType: classifyFailureType(s.title),
  }));

  return NextResponse.json({
    machinesDown,
    pmsDue: digest.pmsDue,
    stats: digest.stats,
    openCritical,
    recentClosed,
    handoverNotes: notes.slice(0, 5).map((n) => ({ id: n.id, note: n.note, category: n.category, priority: n.priority, assetName: n.assetName })),
    recentSessions,
  });
});
