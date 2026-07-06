/**
 * KPI metrics calculation for the per-organization dashboard.
 *
 * Metrics:
 *   - MTTR (Mean Time To Repair): avg(closedAt - startedAt) for closed WOs
 *   - MTBF (Mean Time Between Failures): avg time between consecutive failures per asset
 *   - Open Work Orders: count by priority
 *   - PM Compliance: completed / (completed + overdue) PMs
 *   - Downtime Hours: sum of downtimeMins from closed WOs this period
 *   - Work Order Volume: count of WOs created per week/month
 *   - Asset Health: % of assets in operational status
 */

import { db, ensureDb } from "@/lib/db";
import { workOrders, assets, pmSchedules, pmCompletions, pmPrograms, orgs } from "@/lib/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export interface KpiSummary {
  mttrHours: number | null; // avg hours to repair
  mtbfDays: number | null; // avg days between failures
  openWorkOrders: { total: number; urgent: number; high: number; medium: number; low: number };
  pmCompliance: number | null; // 0-100 percentage
  downtimeHours: number; // total this period
  // ROI: dollarized downtime + period-over-period comparison (honest — null cost
  // until a rate is set; the UI shows hours only in that case).
  downtimeCostPerHour: number | null;
  downtimeCost: number | null; // downtimeHours × rate, or null when no rate
  prevDowntimeHours: number; // equal-length window before this period
  downtimeDeltaPct: number | null; // signed % vs prior period (negative = down)
  assetHealth: { total: number; operational: number; degraded: number; down: number };
  workOrderTrend: { period: string; count: number }[]; // last 12 weeks
  downtimeTrend: { period: string; hours: number }[]; // last 12 weeks
}

export async function calculateKpis(orgId: string, periodDays = 90): Promise<KpiSummary> {
  await ensureDb();
  const now = Date.now();
  const periodStart = now - periodDays * 24 * 60 * 60 * 1000;

  // Fetch all work orders for this org
  const allWOs = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orgId, orgId));

  const periodWOs = allWOs.filter(
    (w) => w.createdAt && w.createdAt.getTime() >= periodStart
  );

  // MTTR: average (closedAt - startedAt) for closed WOs with both timestamps
  const closedWithTimes = allWOs.filter(
    (w) => w.status === "done" && w.startedAt && w.closedAt
  );
  const mttrMs = closedWithTimes.length
    ? closedWithTimes.reduce((sum, w) => {
        const closed = w.closedAt instanceof Date ? w.closedAt.getTime() : Number(w.closedAt);
        const started = w.startedAt instanceof Date ? w.startedAt.getTime() : Number(w.startedAt);
        return sum + (closed - started);
      }, 0) / closedWithTimes.length
    : null;
  const mttrHours = mttrMs !== null ? Math.round((mttrMs / (1000 * 60 * 60)) * 10) / 10 : null;

  // MTBF: average days between consecutive corrective WOs per asset
  const correctiveByAsset = new Map<string, number[]>();
  allWOs
    .filter((w) => w.type === "corrective" && w.assetId && w.createdAt)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .forEach((w) => {
      const arr = correctiveByAsset.get(w.assetId!) || [];
      arr.push(w.createdAt.getTime());
      correctiveByAsset.set(w.assetId!, arr);
    });

  let totalGaps = 0;
  let gapCount = 0;
  for (const times of correctiveByAsset.values()) {
    for (let i = 1; i < times.length; i++) {
      totalGaps += times[i] - times[i - 1];
      gapCount++;
    }
  }
  const mtbfDays = gapCount > 0 ? Math.round((totalGaps / gapCount / (1000 * 60 * 60 * 24)) * 10) / 10 : null;

  // Open work orders by priority
  const openWOs = allWOs.filter((w) => w.status === "open" || w.status === "in_progress");
  const openWorkOrdersKpi = {
    total: openWOs.length,
    urgent: openWOs.filter((w) => w.priority === "urgent").length,
    high: openWOs.filter((w) => w.priority === "high").length,
    medium: openWOs.filter((w) => w.priority === "medium").length,
    low: openWOs.filter((w) => w.priority === "low").length,
  };

  // PM Compliance: completed / total scheduled in period
  const schedules = await db
    .select()
    .from(pmSchedules)
    .where(and(eq(pmSchedules.orgId, orgId), eq(pmSchedules.active, true)));
  const completions = await db
    .select()
    .from(pmCompletions)
    .where(eq(pmCompletions.orgId, orgId));
  const periodCompletions = completions.filter(
    (c) => c.completedAt && c.completedAt.getTime() >= periodStart
  );
  // Simple compliance: if we have schedules, what % had at least one completion in period
  const pmCompliance =
    schedules.length > 0
      ? Math.round(
          (schedules.filter((s) =>
            periodCompletions.some((c) => c.pmProgramId === s.pmProgramId)
          ).length /
            schedules.length) *
            100
        )
      : null;

  // Downtime hours this period
  const downtimeHours = Math.round(
    periodWOs
      .filter((w) => w.downtimeMins)
      .reduce((sum, w) => sum + (w.downtimeMins || 0), 0) / 60 * 10
  ) / 10;

  // Prior equal-length window, for a period-over-period verdict.
  const prevStart = periodStart - periodDays * 24 * 60 * 60 * 1000;
  const prevWOs = allWOs.filter(
    (w) => w.createdAt && w.createdAt.getTime() >= prevStart && w.createdAt.getTime() < periodStart
  );
  const prevDowntimeHours = Math.round(
    prevWOs
      .filter((w) => w.downtimeMins)
      .reduce((sum, w) => sum + (w.downtimeMins || 0), 0) / 60 * 10
  ) / 10;
  const downtimeDeltaPct =
    prevDowntimeHours > 0
      ? Math.round(((downtimeHours - prevDowntimeHours) / prevDowntimeHours) * 100)
      : null;

  // Dollarize with the org's fully-loaded downtime rate (null until set).
  const orgRow = (await db.select().from(orgs).where(eq(orgs.id, orgId)))[0];
  const downtimeCostPerHour =
    orgRow?.downtimeCostPerHour != null && orgRow.downtimeCostPerHour > 0
      ? orgRow.downtimeCostPerHour
      : null;
  const downtimeCost =
    downtimeCostPerHour != null ? Math.round(downtimeHours * downtimeCostPerHour) : null;

  // Asset health
  const allAssets = await db.select().from(assets).where(eq(assets.orgId, orgId));
  const assetHealth = {
    total: allAssets.length,
    operational: allAssets.filter((a) => !a.status || a.status === "operational").length,
    degraded: allAssets.filter((a) => a.status === "degraded").length,
    down: allAssets.filter((a) => a.status === "down" || a.status === "maintenance").length,
  };

  // Work order trend: last 12 weeks
  const workOrderTrend: { period: string; count: number }[] = [];
  const downtimeTrend: { period: string; hours: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const weekStart = now - (i + 1) * 7 * 24 * 60 * 60 * 1000;
    const weekEnd = now - i * 7 * 24 * 60 * 60 * 1000;
    const weekLabel = new Date(weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const weekWOs = allWOs.filter(
      (w) => w.createdAt && w.createdAt.getTime() >= weekStart && w.createdAt.getTime() < weekEnd
    );
    workOrderTrend.push({ period: weekLabel, count: weekWOs.length });

    const weekDowntime = weekWOs
      .filter((w) => w.downtimeMins)
      .reduce((sum, w) => sum + (w.downtimeMins || 0), 0) / 60;
    downtimeTrend.push({ period: weekLabel, hours: Math.round(weekDowntime * 10) / 10 });
  }

  return {
    mttrHours,
    mtbfDays,
    openWorkOrders: openWorkOrdersKpi,
    pmCompliance,
    downtimeHours,
    downtimeCostPerHour,
    downtimeCost,
    prevDowntimeHours,
    downtimeDeltaPct,
    assetHealth,
    workOrderTrend,
    downtimeTrend,
  };
}
