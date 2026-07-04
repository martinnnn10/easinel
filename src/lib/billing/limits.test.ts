import { describe, it, expect, beforeAll, afterEach } from "vitest";
process.env.DATABASE_URL = ":memory:";

import { ensureDb, db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { id } from "@/lib/util";
import { createOrg, createUser } from "@/lib/auth/session";
import { createTrialSubscription, recordStripeEvent, updateSubscriptionFromStripe, getSubscription } from "./subscription";
import { canAddUser, orgUserCount, storageStatus, canUpload, orgStorageBytes } from "./limits";
import { planFromStripePrice, stripePriceForPlan } from "./stripeMap";
import { can } from "@/lib/auth/roles";
import { getPlan } from "./plans";

async function addDoc(orgId: string, bytes: number) {
  await db.insert(documents).values({ id: id("doc"), orgId, filename: "f.pdf", kind: "document", sizeBytes: bytes, charCount: 0 });
}

describe("plan user limits", () => {
  beforeAll(async () => { await ensureDb(); });
  afterEach(() => { delete process.env.PLAN_USERS_PILOT; });

  it("blocks inviting/creating users past the plan cap", async () => {
    const org = await createOrg("Seat Co");
    await createTrialSubscription(org); // free_trial → 10 users
    process.env.PLAN_USERS_PILOT = "2"; // not this plan; use free_trial default 10
    // Fill to the free_trial cap (10) — create 10 users.
    for (let i = 0; i < 10; i++) await createUser({ orgId: org, email: `u${i}@x.com`, name: `U${i}`, role: "technician" });
    expect(await orgUserCount(org)).toBe(10);
    const d = await canAddUser(org);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/users/i);
    expect(d.limit).toBe(10);
  });

  it("allows adding a user when under the cap", async () => {
    const org = await createOrg("Room Co");
    await createTrialSubscription(org);
    await createUser({ orgId: org, email: "solo@x.com", name: "Solo", role: "owner" });
    const d = await canAddUser(org);
    expect(d.allowed).toBe(true);
  });
});

describe("plan storage limits", () => {
  beforeAll(async () => { await ensureDb(); });
  afterEach(() => { delete process.env.PLAN_STORAGE_GB_FREE_TRIAL; });

  it("warns at 80% and blocks new uploads at 100% (never deletes)", async () => {
    const org = await createOrg("Store Co");
    await createTrialSubscription(org);
    process.env.PLAN_STORAGE_GB_FREE_TRIAL = "1"; // 1 GB = 1e9 bytes cap
    await addDoc(org, 850_000_000); // 85% → warn
    let s = await storageStatus(org);
    expect(s.warn).toBe(true);
    expect(s.over).toBe(false);
    // A 200 MB upload would push to 1.05 GB → over → blocked.
    const block = await canUpload(org, 200_000_000);
    expect(block.allowed).toBe(false);
    expect(block.reason).toMatch(/storage/i);
    // A small 10 MB upload still fits.
    const okUp = await canUpload(org, 10_000_000);
    expect(okUp.allowed).toBe(true);
    // Existing bytes are unchanged (nothing deleted/hidden).
    expect(await orgStorageBytes(org)).toBe(850_000_000);
  });

  it("reports over=100% when already at the cap", async () => {
    const org = await createOrg("Full Co");
    await createTrialSubscription(org);
    process.env.PLAN_STORAGE_GB_FREE_TRIAL = "1";
    await addDoc(org, 1_000_000_000); // exactly at cap
    const s = await storageStatus(org);
    expect(s.over).toBe(true);
    expect((await canUpload(org, 1)).allowed).toBe(false);
  });
});

describe("RBAC: technician cannot manage billing; org isolation", () => {
  beforeAll(async () => { await ensureDb(); });

  it("technician lacks billing management permission", () => {
    expect(can("technician", "manage_billing")).toBe(false);
    expect(can("owner", "manage_billing")).toBe(true);
    expect(can("admin", "manage_billing")).toBe(true);
  });

  it("usage/limits are strictly org-scoped (Org A cannot see Org B)", async () => {
    const a = await createOrg("Iso A");
    const b = await createOrg("Iso B");
    await createTrialSubscription(a);
    await createTrialSubscription(b);
    await addDoc(a, 500_000_000);
    await createUser({ orgId: a, email: "a@x.com", name: "A", role: "owner" });
    expect(await orgStorageBytes(a)).toBe(500_000_000);
    expect(await orgStorageBytes(b)).toBe(0); // B sees none of A's storage
    expect(await orgUserCount(b)).toBe(0);
  });
});

describe("Stripe webhook idempotency + plan mapping", () => {
  beforeAll(async () => { await ensureDb(); });
  afterEach(() => { delete process.env.STRIPE_PRICE_PILOT; delete process.env.STRIPE_PRICE_PROFESSIONAL; });

  it("processes a Stripe event id once (idempotent)", async () => {
    expect(await recordStripeEvent("evt_test_1", "customer.subscription.updated")).toBe(true);
    expect(await recordStripeEvent("evt_test_1", "customer.subscription.updated")).toBe(false); // redelivery
    expect(await recordStripeEvent("evt_test_2", "checkout.session.completed")).toBe(true);
  });

  it("maps Stripe price ids to internal plan codes", () => {
    process.env.STRIPE_PRICE_PILOT = "price_pilot_123";
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_pro_456";
    expect(planFromStripePrice("price_pilot_123")).toBe("pilot");
    expect(planFromStripePrice("price_pro_456")).toBe("professional");
    expect(planFromStripePrice("price_unknown")).toBe("professional"); // safe default
    expect(stripePriceForPlan("pilot")).toBe("price_pilot_123");
    expect(getPlan("pilot").aiQuestionsPerMonth).toBe(1000);
  });

  it("webhook subscription update maps price → plan server-side", async () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_pro_789";
    const org = await createOrg("Webhook Co");
    await createTrialSubscription(org);
    // Simulate what the webhook does: map price → plan, then update.
    const plan = planFromStripePrice("price_pro_789");
    await updateSubscriptionFromStripe(org, { status: "active", plan, stripeSubscriptionId: "sub_1" });
    const sub = await getSubscription(org);
    expect(sub?.plan).toBe("professional");
    expect(sub?.status).toBe("active");
  });
});
