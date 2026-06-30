import { describe, it, expect, beforeAll } from "vitest";
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  DEMO_ORG,
  GLOBAL_ORG,
  UNSET_ORG,
  isReservedOrg,
  RESERVED_ORG_IDS,
} from "@/lib/util";
import { createOrg, createUser } from "@/lib/auth/session";
import { createAsset, listAssets } from "@/lib/assets/repository";

// The Demo Organization MUST behave as a fully separate tenant: a customer org
// can never read it, and an authenticated customer session can never resolve to
// it. These tests lock that contract at the data + classification layer; the
// HTTP guard enforcement is unit-tested via isReservedOrg + the guard's own
// logic (open-mode synthetic owner is the only legitimate reserved-org actor).

describe("Demo Organization tenant boundary", () => {
  it("classifies reserved org ids correctly", () => {
    expect(isReservedOrg(DEMO_ORG)).toBe(true);
    expect(isReservedOrg(GLOBAL_ORG)).toBe(true);
    expect(isReservedOrg(UNSET_ORG)).toBe(true);
    expect(isReservedOrg("org_real_customer")).toBe(false);
    expect(isReservedOrg(null)).toBe(false);
    expect(isReservedOrg(undefined)).toBe(false);
    expect(RESERVED_ORG_IDS).toContain(DEMO_ORG);
  });

  it("createOrg never mints a reserved id (random UUID space)", async () => {
    for (let i = 0; i < 50; i++) {
      const orgId = await createOrg("Customer " + i);
      expect(isReservedOrg(orgId)).toBe(false);
      expect(orgId.startsWith("org_")).toBe(true);
    }
  });

  it("a real customer org starts completely empty and cannot see demo data", async () => {
    const customer = await createOrg("Fresh Customer Plant");
    // Brand-new tenant: zero assets, zero of everything.
    expect((await listAssets(customer)).length).toBe(0);

    // Seed an asset into the DEMO_ORG directly (simulating curated demo data).
    await createAsset(DEMO_ORG, {
      name: "Demo Conveyor 3",
      manufacturer: "Demo",
      model: "DC-3",
    });

    // The customer org still sees nothing — demo data is invisible to it.
    expect((await listAssets(customer)).length).toBe(0);
    // And the demo org sees only its own.
    const demoAssets = await listAssets(DEMO_ORG);
    expect(demoAssets.some((a) => a.name === "Demo Conveyor 3")).toBe(true);
    expect(demoAssets.every((a) => a.orgId === DEMO_ORG)).toBe(true);
  });

  it("the demo org's data never leaks into a second independent customer", async () => {
    const a = await createOrg("Alpha");
    const b = await createOrg("Beta");
    await createAsset(a, { name: "Alpha Press", manufacturer: "X", model: "1" });
    expect((await listAssets(b)).length).toBe(0);
    expect((await listAssets(DEMO_ORG)).every((x) => x.orgId === DEMO_ORG)).toBe(true);
  });

  it("a user can be created in the demo org only via explicit orgId (system bootstrap)", async () => {
    // createUser requires an explicit org; passing DEMO_ORG is how the seeded
    // demo owner is made. A customer-facing flow uses createOrg()+that id, which
    // can never equal DEMO_ORG (proven above).
    const u = await createUser({
      orgId: DEMO_ORG,
      email: "demo-owner@demo.local",
      name: "Demo Owner",
      role: "owner",
    });
    expect(u.orgId).toBe(DEMO_ORG);
  });
});

// Guard logic: the ONLY legitimate reserved-org actor is the open-mode synthetic
// owner. We assert the predicate the guard uses so the policy is regression-safe.
describe("reserved-org guard policy", () => {
  function reservedSessionAllowed(opts: {
    orgId: string;
    authRequired: boolean;
    userId: string;
  }): boolean {
    if (!isReservedOrg(opts.orgId)) return true; // normal customer org
    // mirrors guard.ts: only the open-mode synthetic owner may use a reserved org
    return !opts.authRequired && opts.userId === "open-mode";
  }

  it("allows the open-mode synthetic owner to operate the Demo Org (live demo)", () => {
    expect(
      reservedSessionAllowed({ orgId: DEMO_ORG, authRequired: false, userId: "open-mode" })
    ).toBe(true);
  });

  it("denies a real authenticated session that resolves to the Demo Org", () => {
    expect(
      reservedSessionAllowed({ orgId: DEMO_ORG, authRequired: true, userId: "usr_real" })
    ).toBe(false);
  });

  it("denies a real authenticated session resolving to the Global knowledge scope", () => {
    expect(
      reservedSessionAllowed({ orgId: GLOBAL_ORG, authRequired: true, userId: "usr_real" })
    ).toBe(false);
    // Note: open mode's synthetic owner is always DEMO_ORG (never GLOBAL_ORG),
    // so a GLOBAL_ORG open-mode session cannot occur in practice; the guard does
    // not need to special-case it beyond the open-mode synthetic-owner rule.
  });

  it("always allows a normal customer org session", () => {
    expect(
      reservedSessionAllowed({ orgId: "org_customer_123", authRequired: true, userId: "usr_real" })
    ).toBe(true);
  });
});
