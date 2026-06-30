import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL so the repositories exercise the real SQL path. MUST be set
// before importing the db module.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createAsset,
  getAsset,
  listAssets,
  updateAsset,
  deleteAsset,
} from "@/lib/assets/repository";
import {
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
} from "@/lib/workorders/repository";
import { createPart, listParts, searchParts } from "@/lib/parts/repository";
import {
  createProgram,
  getProgram,
  listPrograms,
} from "@/lib/pm/repository";
import {
  getOrCreateConversation,
  addMessage,
  listMessages,
  listConversations,
} from "@/lib/queries";

// Two completely independent tenants. The entire promise of the platform is
// that ORG_A can NEVER observe or mutate a single row that belongs to ORG_B,
// and vice-versa. These tests are the enforceable contract behind that promise.
const ORG_A = "org_alpha_mfg";
const ORG_B = "org_beta_industrial";

// Handles to cross-reference: an ID minted in one tenant must be inert in the
// other. We capture them in beforeAll and assert against them throughout.
let assetA = "";
let assetB = "";
let woA = "";
let pmA = "";
let convA = "";

describe("multi-tenant data isolation (the core enterprise guarantee)", () => {
  beforeAll(async () => {
    // Seed parallel data in both tenants.
    const a1 = await createAsset(ORG_A, { name: "Alpha Line 3 Conveyor", assetTag: "A-CONV-03" });
    assetA = a1.id;
    const b1 = await createAsset(ORG_B, { name: "Beta Press #1", assetTag: "B-PRESS-01" });
    assetB = b1.id;

    const wo = await createWorkOrder(ORG_A, { title: "Alpha bearing replacement", assetId: assetA });
    woA = wo.id;

    const pm = await createProgram(
      ORG_A,
      { title: "Alpha quarterly lube", assetId: assetA, intervalDays: 90 },
      "mgr@alpha.com"
    );
    pmA = pm.id;

    await createPart(ORG_A, { description: "Alpha SKF 6204 bearing", partNumber: "SKF-6204" });
    await createPart(ORG_B, { description: "Beta hydraulic seal", partNumber: "BETA-SEAL-9" });

    convA = await getOrCreateConversation(ORG_A, null, assetA, "Why is Alpha conveyor tripping?");
    await addMessage(ORG_A, convA, "user", "Why is Alpha conveyor tripping?");
  });

  // ---- ASSETS ----------------------------------------------------------------
  it("listAssets returns only the caller's tenant rows", async () => {
    const aList = await listAssets(ORG_A);
    const bList = await listAssets(ORG_B);
    expect(aList.every((a) => a.id !== assetB)).toBe(true);
    expect(bList.every((a) => a.id !== assetA)).toBe(true);
    expect(aList.some((a) => a.id === assetA)).toBe(true);
    expect(bList.some((a) => a.id === assetB)).toBe(true);
  });

  it("getAsset cannot read another tenant's asset by id", async () => {
    // ORG_B asking for ORG_A's asset id must get nothing.
    expect(await getAsset(ORG_B, assetA)).toBeUndefined();
    expect(await getAsset(ORG_A, assetB)).toBeUndefined();
    // Sanity: each tenant CAN read its own.
    expect((await getAsset(ORG_A, assetA))?.id).toBe(assetA);
  });

  it("updateAsset cannot mutate another tenant's asset", async () => {
    const before = await getAsset(ORG_A, assetA);
    // ORG_B attempts to rename ORG_A's asset — must be a no-op.
    await updateAsset(ORG_B, assetA, { name: "HIJACKED" });
    const after = await getAsset(ORG_A, assetA);
    expect(after?.name).toBe(before?.name);
    expect(after?.name).not.toBe("HIJACKED");
  });

  it("deleteAsset cannot remove another tenant's asset", async () => {
    await deleteAsset(ORG_B, assetA); // cross-tenant delete attempt
    expect((await getAsset(ORG_A, assetA))?.id).toBe(assetA); // still there
  });

  // ---- WORK ORDERS -----------------------------------------------------------
  it("work orders are tenant-scoped on read and list", async () => {
    expect(await getWorkOrder(ORG_B, woA)).toBeUndefined();
    const bList = await listWorkOrders(ORG_B);
    expect(bList.every((w) => w.id !== woA)).toBe(true);
    expect((await getWorkOrder(ORG_A, woA))?.id).toBe(woA);
  });

  // ---- PM PROGRAMS -----------------------------------------------------------
  it("PM programs are tenant-scoped on read and list", async () => {
    expect(await getProgram(ORG_B, pmA)).toBeNull();
    const bList = await listPrograms(ORG_B);
    expect(bList.every((p) => p.id !== pmA)).toBe(true);
    expect((await getProgram(ORG_A, pmA))?.id).toBe(pmA);
  });

  // ---- PARTS -----------------------------------------------------------------
  it("parts lists and search never cross tenants", async () => {
    const aParts = await listParts(ORG_A);
    const bParts = await listParts(ORG_B);
    expect(aParts.some((p) => p.description.includes("Alpha"))).toBe(true);
    expect(aParts.every((p) => !p.description.includes("Beta"))).toBe(true);
    expect(bParts.every((p) => !p.description.includes("Alpha"))).toBe(true);

    // ORG_B searching for ORG_A's exact part number returns nothing.
    const leak = await searchParts(ORG_B, "SKF-6204");
    expect(leak.length).toBe(0);
  });

  // ---- CONVERSATIONS / MESSAGES ---------------------------------------------
  it("a conversation id from another tenant is inert", async () => {
    // ORG_B passing ORG_A's conversation id must NOT resume it; it should mint a
    // brand-new conversation in ORG_B instead.
    const reused = await getOrCreateConversation(ORG_B, convA, null, "Beta question");
    expect(reused).not.toBe(convA);
    // And ORG_B cannot read ORG_A's messages.
    const bMsgs = await listMessages(ORG_B, convA);
    expect(bMsgs.length).toBe(0);
    // ORG_A still sees its own.
    const aMsgs = await listMessages(ORG_A, convA);
    expect(aMsgs.length).toBeGreaterThan(0);
  });

  it("listConversations is tenant-scoped", async () => {
    const aConvs = await listConversations(ORG_A);
    const bConvs = await listConversations(ORG_B);
    expect(aConvs.some((c) => c.id === convA)).toBe(true);
    expect(bConvs.every((c) => c.id !== convA)).toBe(true);
  });

  // ---- HARD-ERROR CONTRACT ---------------------------------------------------
  it("repository functions reject a missing orgId (no silent default)", async () => {
    // @ts-expect-error — intentionally calling without orgId to prove it throws.
    await expect(createPart(undefined, { description: "x" })).rejects.toThrow();
  });
});
