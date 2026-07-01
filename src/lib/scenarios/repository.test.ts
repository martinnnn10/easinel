import { describe, it, expect } from "vitest";

import {
  createScenario,
  getScenario,
  listScenarios,
  updateScenario,
  deleteScenario,
  archiveScenario,
} from "./repository";

const ORG_A = "org_scn_a";
const ORG_B = "org_scn_b";

describe("scenario repository — CRUD + asset-first", () => {
  it("creates a scenario owned by its org and actor", async () => {
    const s = await createScenario(ORG_A, { title: "F007 after warm-up", symptom: "trips at 20 min", assetId: "ast_1" }, "user_a");
    expect(s.orgId).toBe(ORG_A);
    expect(s.createdBy).toBe("user_a");
    expect(s.title).toBe("F007 after warm-up");
    expect(s.assetId).toBe("ast_1");
  });

  it("derives a title from the symptom when none is given", async () => {
    const s = await createScenario(ORG_A, { symptom: "photoeye randomly misses parts", assetId: "ast_2" }, "u");
    expect(s.title.length).toBeGreaterThan(0);
  });

  it("keeps a scenario WITHOUT an asset as a draft, never complete (asset-first)", async () => {
    const s = await createScenario(ORG_A, { title: "orphan", status: "complete" }, "u");
    expect(s.assetId).toBeNull();
    expect(s.status).toBe("draft"); // cannot be complete without an asset
  });

  it("allows complete only once an asset is attached", async () => {
    const s = await createScenario(ORG_A, { title: "needs asset", status: "complete" }, "u");
    expect(s.status).toBe("draft");
    const updated = await updateScenario(ORG_A, s.id, { assetId: "ast_9", status: "complete" }, "u");
    expect(updated?.assetId).toBe("ast_9");
    expect(updated?.status).toBe("complete");
  });

  it("archives and deletes", async () => {
    const s = await createScenario(ORG_A, { title: "to remove", assetId: "ast_3" }, "u");
    const archived = await archiveScenario(ORG_A, s.id, "u");
    expect(archived?.status).toBe("archived");
    expect(await deleteScenario(ORG_A, s.id, "u")).toBe(true);
    expect(await getScenario(ORG_A, s.id)).toBeUndefined();
  });
});

describe("scenario repository — ORG ISOLATION (non-negotiable)", () => {
  it("org A cannot READ org B's scenario", async () => {
    const b = await createScenario(ORG_B, { title: "B-secret", assetId: "ast_b" }, "user_b");
    // Same id, wrong org → nothing.
    expect(await getScenario(ORG_A, b.id)).toBeUndefined();
    // Correct org → found.
    expect((await getScenario(ORG_B, b.id))?.id).toBe(b.id);
  });

  it("org A cannot EDIT org B's scenario", async () => {
    const b = await createScenario(ORG_B, { title: "B-editable", assetId: "ast_b" }, "user_b");
    const attempt = await updateScenario(ORG_A, b.id, { title: "hacked" }, "user_a");
    expect(attempt).toBeUndefined(); // scoped: not found in org A
    expect((await getScenario(ORG_B, b.id))?.title).toBe("B-editable"); // untouched
  });

  it("org A cannot DELETE org B's scenario", async () => {
    const b = await createScenario(ORG_B, { title: "B-permanent", assetId: "ast_b" }, "user_b");
    expect(await deleteScenario(ORG_A, b.id, "user_a")).toBe(false);
    expect((await getScenario(ORG_B, b.id))?.id).toBe(b.id); // still there
  });

  it("listScenarios returns ONLY the caller's org", async () => {
    await createScenario(ORG_A, { title: "A-only", assetId: "ast_a" }, "user_a");
    await createScenario(ORG_B, { title: "B-only", assetId: "ast_b" }, "user_b");
    const aList = await listScenarios(ORG_A);
    const bList = await listScenarios(ORG_B);
    expect(aList.every((s) => s.orgId === ORG_A)).toBe(true);
    expect(bList.every((s) => s.orgId === ORG_B)).toBe(true);
    expect(aList.some((s) => s.title === "B-only")).toBe(false);
    expect(bList.some((s) => s.title === "A-only")).toBe(false);
  });

  it("requires orgId on every entry point", async () => {
    await expect(getScenario("", "x")).rejects.toThrow();
    await expect(listScenarios("")).rejects.toThrow();
    // @ts-expect-error intentional: missing orgId
    await expect(createScenario(undefined, { title: "x" })).rejects.toThrow();
  });
});
