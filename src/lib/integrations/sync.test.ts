import { describe, it, expect, beforeEach, afterEach } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { assets, workOrders, pmPrograms, integrations } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { syncIntegration, pushPmToConnector, connectIntegration } from "./service";
import type { ConnectorAdapter } from "./adapter";
import { id } from "@/lib/util";

const ORG = "org_sync";

// A fake MaintainX whose returned records we control per test — no network.
function fakeAdapter(state: { assets: any[]; wos: any[]; pushed: any[] }): ConnectorAdapter {
  return {
    def: { key: "maintainx", name: "MaintainX", category: "cmms", blurb: "", auth: "api_key", capabilities: ["push_work_order", "pull_work_orders", "pull_assets"] },
    async testConnection() { return { ok: true, detail: "ok" }; },
    async pullAssets() { return state.assets; },
    async pullWorkOrders() { return state.wos; },
    async pushWorkOrder(input) { state.pushed.push(input); return { externalId: "MX-999", externalSystem: "MaintainX", url: "https://app.getmaintainx.com/workorders/MX-999" }; },
  };
}

async function seedIntegrationRow() {
  await db.insert(integrations).values({ id: id("int"), orgId: ORG, connectorKey: "maintainx", name: "MaintainX", category: "cmms", status: "connected" });
}

beforeEach(async () => {
  await ensureDb();
  delete process.env.MAINTAINX_API_KEY;
});
afterEach(() => { delete process.env.MAINTAINX_API_KEY; });

describe("integration sync — trust gate", () => {
  it("does NOT import sandbox data into a real org without live credentials", async () => {
    await seedIntegrationRow();
    const fake = fakeAdapter({ assets: [{ externalId: "A1", name: "Filler 1" }], wos: [{ externalId: "W1", title: "Fix filler", status: "open" }], pushed: [] });
    const r = await syncIntegration(ORG, "maintainx", { adapter: fake });
    expect(r.imported).toBe(false);
    expect(r.mode).toBe("sandbox");
    expect(r.assetsImported).toBe(0);
    // Nothing was written to the workspace.
    const a = await db.select().from(assets).where(eq(assets.orgId, ORG));
    expect(a).toHaveLength(0);
  });

  it("imports real records once live credentials are present", async () => {
    process.env.MAINTAINX_API_KEY = "live-test-key";
    await seedIntegrationRow();
    const fake = fakeAdapter({
      assets: [{ externalId: "A1", name: "Filler 1", manufacturer: "Krones" }],
      wos: [{ externalId: "W1", title: "Fix filler", status: "open", priority: "high" }],
      pushed: [],
    });
    const r = await syncIntegration(ORG, "maintainx", { adapter: fake });
    expect(r.imported).toBe(true);
    expect(r.mode).toBe("live");
    expect(r.assetsImported).toBe(1);
    expect(r.workOrdersImported).toBe(1);
  });
});

describe("integration sync — two-way status upsert", () => {
  it("updates an already-imported WO when its upstream status changes", async () => {
    process.env.MAINTAINX_API_KEY = "live-test-key";
    await seedIntegrationRow();
    const state = { assets: [], wos: [{ externalId: "W1", title: "Fix filler", status: "open", priority: "medium" }], pushed: [] };
    const fake = fakeAdapter(state);
    // First sync imports it as open.
    await syncIntegration(ORG, "maintainx", { adapter: fake });
    let row = (await db.select().from(workOrders).where(and(eq(workOrders.orgId, ORG), eq(workOrders.externalId, "W1"))))[0];
    expect(row.status).toBe("open");
    // MaintainX closes it; re-sync must reflect the new status (not a duplicate).
    state.wos[0].status = "done";
    const r = await syncIntegration(ORG, "maintainx", { adapter: fake });
    expect(r.workOrdersImported).toBe(0);
    expect(r.workOrdersUpdated).toBe(1);
    const all = await db.select().from(workOrders).where(and(eq(workOrders.orgId, ORG), eq(workOrders.externalId, "W1")));
    expect(all).toHaveLength(1); // no duplicate
    expect(all[0].status).toBe("done");
  });
});

describe("integration push — PM back to CMMS", () => {
  it("pushes an EAS PM as a work order only when live", async () => {
    await db.insert(pmPrograms).values({ id: "pm_1", orgId: ORG, title: "Monthly filter clean", failureMode: "F007 overload", frequencyLabel: "Monthly" });
    const state = { assets: [], wos: [], pushed: [] as any[] };
    const fake = fakeAdapter(state);

    // Preview (no creds) → refuses to push, nothing fabricated.
    const blocked = await pushPmToConnector(ORG, "maintainx", "pm_1", { adapter: fake });
    expect(blocked.pushed).toBe(false);
    expect(state.pushed).toHaveLength(0);

    // Live → pushes, carrying the PM's real title + rationale.
    process.env.MAINTAINX_API_KEY = "live-test-key";
    const ok = await pushPmToConnector(ORG, "maintainx", "pm_1", { adapter: fake });
    expect(ok.pushed).toBe(true);
    expect(ok.result?.externalId).toBe("MX-999");
    expect(state.pushed[0].title).toContain("Monthly filter clean");
  });
});
