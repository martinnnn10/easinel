import { db, ensureDb } from "@/lib/db";
import { integrations, assets, workOrders, type Integration } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id } from "@/lib/util";
import { CONNECTORS, getConnector } from "./registry";
import { getAdapter } from "./adapter";
import { emitEvent } from "@/lib/events";

export async function listIntegrations(orgId: string): Promise<Integration[]> {
  if (!orgId) throw new Error("listIntegrations() requires orgId");
  await ensureDb();
  return db
    .select()
    .from(integrations)
    .where(eq(integrations.orgId, orgId))
    .orderBy(desc(integrations.updatedAt));
}

export async function connectIntegration(
  orgId: string,
  connectorKey: string,
  config?: Record<string, unknown>
): Promise<{ integration: Integration; test: { ok: boolean; detail: string } }> {
  if (!orgId) throw new Error("connectIntegration() requires orgId");
  await ensureDb();
  const def = getConnector(connectorKey);
  if (!def) throw new Error(`Unknown connector: ${connectorKey}`);

  const adapter = getAdapter(connectorKey)!;
  const test = await adapter.testConnection();

  const existing = (
    await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.orgId, orgId), eq(integrations.connectorKey, connectorKey)))
  )[0];

  const status = test.ok ? "connected" : "error";
  let row: Integration;
  if (existing) {
    await db
      .update(integrations)
      .set({ status, config: JSON.stringify(config ?? {}), updatedAt: new Date() })
      .where(and(eq(integrations.orgId, orgId), eq(integrations.id, existing.id)));
    row = { ...existing, status, config: JSON.stringify(config ?? {}) };
  } else {
    const intId = id("int");
    await db.insert(integrations).values({
      id: intId,
      orgId,
      connectorKey,
      name: def.name,
      category: def.category,
      status,
      config: JSON.stringify(config ?? {}),
    });
    row = (await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.id, intId))))[0];
  }

  if (test.ok) await emitEvent(orgId, "integration.connected", { connectorKey, name: def.name });
  return { integration: row, test };
}

export async function disconnectIntegration(orgId: string, connectorKey: string): Promise<void> {
  if (!orgId) throw new Error("disconnectIntegration() requires orgId");
  await ensureDb();
  await db
    .update(integrations)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.connectorKey, connectorKey)));
}

// Run a sandbox/live sync: pulls assets + work orders from the external system
// and upserts them into EAS. Returns a summary of what changed.
export async function syncIntegration(orgId: string, connectorKey: string): Promise<{
  assetsImported: number;
  workOrdersImported: number;
}> {
  if (!orgId) throw new Error("syncIntegration() requires orgId");
  await ensureDb();
  const def = getConnector(connectorKey);
  if (!def) throw new Error(`Unknown connector: ${connectorKey}`);
  const adapter = getAdapter(connectorKey)!;

  let assetsImported = 0;
  let workOrdersImported = 0;

  if (adapter.pullAssets) {
    const ext = await adapter.pullAssets();
    for (const a of ext) {
      const dupe = (
        await db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.orgId, orgId), eq(assets.name, a.name)))
      )[0];
      if (dupe) continue;
      await db.insert(assets).values({
        id: id("ast"),
        orgId,
        name: a.name,
        manufacturer: a.manufacturer ?? null,
        model: a.model ?? null,
        area: a.area ?? null,
        notes: `Imported from ${def.name} (${a.externalId})`,
      });
      assetsImported++;
    }
  }

  if (adapter.pullWorkOrders) {
    const ext = await adapter.pullWorkOrders();
    for (const w of ext) {
      const dupe = (
        await db
          .select({ id: workOrders.id })
          .from(workOrders)
          .where(and(eq(workOrders.orgId, orgId), eq(workOrders.externalId, w.externalId)))
      )[0];
      if (dupe) continue;
      await db.insert(workOrders).values({
        id: id("wo"),
        orgId,
        title: w.title,
        status: w.status === "open" ? "open" : "in_progress",
        priority: w.priority ?? "medium",
        source: connectorKey,
        externalSystem: def.name,
        externalId: w.externalId,
      });
      workOrdersImported++;
    }
  }

  await db
    .update(integrations)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.connectorKey, connectorKey)));

  await emitEvent(orgId, "integration.synced", { connectorKey, assetsImported, workOrdersImported });
  return { assetsImported, workOrdersImported };
}

export function catalog() {
  return CONNECTORS;
}
