import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { generateHandover } from "@/lib/handover/generate";
import { listWorkOrders } from "@/lib/workorders/repository";
import { listHandoverNotes } from "@/lib/handover/notes";
import { listSessions } from "@/lib/queries";

export const runtime = "nodejs";

// GET /api/today — the daily maintenance board: what's down, what needs
// attention, what to do next. Org-scoped; reuses existing repositories (no new
// data model). Lean payload for a calm "Today" page.
export const GET = safeHandler("today.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;

  const [digest, openWos, closedWos, notes, sessions] = await Promise.all([
    generateHandover(orgId, 24),
    listWorkOrders(orgId, { status: "open" }),
    listWorkOrders(orgId, { status: "done" }),
    listHandoverNotes(orgId, 24),
    listSessions(orgId, 5),
  ]);

  const rank = (p: string) => ({ urgent: 0, high: 1, medium: 2, low: 3 }[p] ?? 4);
  const openCritical = [...openWos]
    .sort((a, b) => rank(a.priority) - rank(b.priority))
    .slice(0, 6)
    .map((w) => ({ id: w.id, number: w.number, title: w.title, priority: w.priority, assetId: w.assetId }));

  const ms = (x: unknown): number => (x instanceof Date ? x.getTime() : typeof x === "number" ? x : 0);
  const recentClosed = [...closedWos]
    .sort((a, b) => ms(b.closedAt ?? b.updatedAt) - ms(a.closedAt ?? a.updatedAt))
    .slice(0, 5)
    .map((w) => ({ id: w.id, number: w.number, title: w.title, closedAt: ms(w.closedAt ?? w.updatedAt) || null }));

  return NextResponse.json({
    machinesDown: digest.machinesDown,
    pmsDue: digest.pmsDue,
    stats: digest.stats,
    openCritical,
    recentClosed,
    handoverNotes: notes.slice(0, 5).map((n) => ({ id: n.id, note: n.note, category: n.category, priority: n.priority, assetName: n.assetName })),
    recentSessions: sessions.slice(0, 5).map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
  });
});
