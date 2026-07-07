import { db, ensureDb } from "@/lib/db";
import { integrations, assets, workOrders, pmPrograms, type Integration } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id, demoModeEnabled } from "@/lib/util";
import { CONNECTORS, getConnector } from "./registry";
import { getAdapter, isLiveConnector, type ConnectorAdapter, type PushResult } from "./adapter";
import { emitEvent } from "@/lib/events";

// A sync/push may import/write real records only when it is talking to a REAL
// external system (live credentials present) OR the workspace is an explicitly
// isolated demo. In a real production org WITHOUT live credentials the adapter
// is the deterministic SANDBOX, whose mock data must NEVER be written into a
// customer's workspace — that would be exactly the fabricated data the platform
// forbids. This gate is the single source of truth for "may we import?".
function mayImport(connectorKey: string): boolean {
  return isLiveConnector(connectorKey) || demoModeEnabled();
}

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

export interface SyncResult {
  mode: "live" | "sandbox";
  imported: boolean; // false when import was withheld (sandbox in a real org)
  reason?: string;
  assetsImported: number;
  workOrdersImported: number;
  workOrdersUpdated: number; // existing WOs whose status/priority changed upstream
}

// Two-way inbound sync: pull assets + work orders from the external system and
// UPSERT them into EAS — inserting new records and updating the status/priority
// of ones already imported (so a WO closed in MaintainX shows closed here too).
//
// TRUST: in a real org without live credentials the adapter is the sandbox, and
// its mock data is NEVER written — the sync returns { imported:false } with a
// clear reason instead of injecting fabricated equipment. `opts.adapter` allows
// tests to inject a fake adapter without hitting a live API.
export async function syncIntegration(
  orgId: string,
  connectorKey: string,
  opts: { adapter?: ConnectorAdapter } = {}
): Promise<SyncResult> {
  if (!orgId) throw new Error("syncIntegration() requires orgId");
  await ensureDb();
  const def = getConnector(connectorKey);
  if (!def) throw new Error(`Unknown connector: ${connectorKey}`);
  const adapter = opts.adapter ?? getAdapter(connectorKey)!;
  const live = mayImport(connectorKey);

  // Always stamp the attempt so the UI shows "last checked".
  await db
    .update(integrations)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(and(eq(integrations.orgId, orgId), eq(integrations.connectorKey, connectorKey)));

  if (!live) {
    return {
      mode: "sandbox",
      imported: false,
      reason: `${def.name} is in preview. Add a live ${def.name} API key (${connectorKey.toUpperCase()}_API_KEY) to import your real assets and work orders — no sample data is ever written to your workspace.`,
      assetsImported: 0,
      workOrdersImported: 0,
      workOrdersUpdated: 0,
    };
  }

  let assetsImported = 0;
  let workOrdersImported = 0;
  let workOrdersUpdated = 0;

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
      const status = w.status === "open" ? "open" : w.status;
      const existing = (
        await db
          .select({ id: workOrders.id, status: workOrders.status, priority: workOrders.priority })
          .from(workOrders)
          .where(and(eq(workOrders.orgId, orgId), eq(workOrders.externalId, w.externalId)))
      )[0];
      if (existing) {
        // Keep already-imported WOs current with upstream status/priority.
        if (existing.status !== status || (w.priority && existing.priority !== w.priority)) {
          await db
            .update(workOrders)
            .set({ status, priority: w.priority ?? existing.priority, updatedAt: new Date() })
            .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, existing.id)));
          workOrdersUpdated++;
        }
        continue;
      }
      await db.insert(workOrders).values({
        id: id("wo"),
        orgId,
        title: w.title,
        status,
        priority: w.priority ?? "medium",
        source: connectorKey,
        externalSystem: def.name,
        externalId: w.externalId,
      });
      workOrdersImported++;
    }
  }

  await emitEvent(orgId, "integration.synced", { connectorKey, assetsImported, workOrdersImported, workOrdersUpdated });
  return { mode: "live", imported: true, assetsImported, workOrdersImported, workOrdersUpdated };
}

export interface PushPmResult {
  pushed: boolean;
  reason?: string;
  result?: PushResult;
}

// Push an EAS-suggested PM back to the connected CMMS as a work order — the
// "intelligence flows back into the tool your team already uses" half of the
// loop. Live-or-demo gated (never fabricate an external link on a real PM), and
// the connector must support push_work_order.
export async function pushPmToConnector(
  orgId: string,
  connectorKey: string,
  pmProgramId: string,
  opts: { adapter?: ConnectorAdapter } = {}
): Promise<PushPmResult> {
  if (!orgId) throw new Error("pushPmToConnector() requires orgId");
  await ensureDb();
  const def = getConnector(connectorKey);
  if (!def) throw new Error(`Unknown connector: ${connectorKey}`);
  if (!def.capabilities.includes("push_work_order")) {
    return { pushed: false, reason: `${def.name} does not support receiving work orders.` };
  }
  if (!mayImport(connectorKey)) {
    return { pushed: false, reason: `${def.name} is in preview. Add a live API key to push PMs to it.` };
  }
  const adapter = opts.adapter ?? getAdapter(connectorKey)!;
  if (!adapter.pushWorkOrder) return { pushed: false, reason: "Connector cannot push work orders." };

  const pm = (
    await db.select().from(pmPrograms).where(and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.id, pmProgramId)))
  )[0];
  if (!pm) return { pushed: false, reason: "PM not found." };

  // Deep link back into EAS, grounded to this machine, so a technician reading
  // the work order in the CMMS can jump to the asset-scoped Copilot and diagnose
  // with the machine's full memory in context. Only when the PM has an asset.
  const base = (process.env.APP_BASE_URL || "https://easmaint.com").replace(/\/+$/, "");
  const diagnoseLink =
    pm.assetId != null
      ? `Diagnose in EAS: ${base}/copilot?asset=${encodeURIComponent(pm.assetId)}&ask=${encodeURIComponent(pm.failureMode || pm.title)}`
      : null;

  const descParts = [
    pm.failureMode ? `Prevents: ${pm.failureMode}` : null,
    pm.frequencyLabel ? `Cadence: ${pm.frequencyLabel}` : null,
    pm.reasoning ? `Rationale: ${pm.reasoning}` : null,
    "Suggested by EAS Maintenance Intelligence from real failure history.",
    diagnoseLink,
  ].filter(Boolean);

  const result = await adapter.pushWorkOrder({
    title: `PM: ${pm.title}`,
    description: descParts.join("\n"),
    priority: "medium",
  });
  await emitEvent(orgId, "integration.pm_pushed", { connectorKey, pmProgramId, externalId: result.externalId });
  return { pushed: true, result };
}

export function catalog() {
  return CONNECTORS;
}
