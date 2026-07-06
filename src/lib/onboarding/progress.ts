/**
 * Activation progress — the real milestones a new org crosses on its way to
 * first value. Every flag is derived from actual records (assets, documents,
 * Copilot conversations, work orders, the downtime rate), never from a stored
 * "onboarding step" the user could game. This drives the Today checklist that
 * turns an empty workspace into the core loop: add a machine → ground it →
 * ask → log work → close with memory → dollarize.
 */

import { db, ensureDb } from "@/lib/db";
import { assets, documents, conversations, workOrders, orgs } from "@/lib/db/schema";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

export interface ActivationProgress {
  hasAsset: boolean;
  hasDocument: boolean;
  hasCopilotChat: boolean;
  hasWorkOrder: boolean;
  hasClosedWithMemory: boolean;
  hasDowntimeRate: boolean;
  completed: number;
  total: number;
  done: boolean;
}

async function count(table: SQLiteTable, where: SQL | undefined): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return Number(rows[0]?.n ?? 0);
}

export async function getActivationProgress(orgId: string): Promise<ActivationProgress> {
  if (!orgId) throw new Error("getActivationProgress() requires orgId");
  await ensureDb();

  const [assetN, docN, chatN, woN, closedMemN, orgRow] = await Promise.all([
    count(assets, eq(assets.orgId, orgId)),
    count(documents, and(eq(documents.orgId, orgId), isNull(documents.archivedAt))),
    count(conversations, eq(conversations.orgId, orgId)),
    count(workOrders, eq(workOrders.orgId, orgId)),
    // A corrective work order closed with real captured knowledge — the moment
    // machine memory is actually created.
    db
      .select({ n: sql<number>`count(*)` })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.orgId, orgId),
          eq(workOrders.status, "done"),
          eq(workOrders.type, "corrective"),
          sql`(coalesce(trim(${workOrders.resolution}), '') <> '' OR coalesce(trim(${workOrders.rootCause}), '') <> '' OR coalesce(trim(${workOrders.repairAction}), '') <> '')`
        )
      )
      .then((r) => Number(r[0]?.n ?? 0)),
    db.select().from(orgs).where(eq(orgs.id, orgId)).then((r) => r[0]),
  ]);

  const flags = {
    hasAsset: assetN > 0,
    hasDocument: docN > 0,
    hasCopilotChat: chatN > 0,
    hasWorkOrder: woN > 0,
    hasClosedWithMemory: closedMemN > 0,
    hasDowntimeRate: orgRow?.downtimeCostPerHour != null && orgRow.downtimeCostPerHour > 0,
  };
  const total = 6;
  const completed = Object.values(flags).filter(Boolean).length;
  return { ...flags, completed, total, done: completed >= total };
}
