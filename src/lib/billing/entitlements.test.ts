import { describe, it, expect, beforeAll, afterEach } from "vitest";
process.env.DATABASE_URL = ":memory:";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy"; // make billing "real" so grace applies

import { ensureDb, db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createOrg } from "@/lib/auth/session";
import { createTrialSubscription } from "@/lib/billing/subscription";
import { getEntitlements, aiEntitlement, uploadEntitlement, inviteEntitlement } from "./entitlements";
import { can } from "@/lib/auth/roles";

// Force an org into a given subscription status.
async function setStatus(orgId: string, status: string) {
  await db.update(subscriptions).set({ status }).where(eq(subscriptions.orgId, orgId));
}

describe("entitlements — active org", () => {
  beforeAll(async () => { await ensureDb(); });
  afterEach(() => { delete process.env.AI_KILL_SWITCH; });

  it("active (trialing) org can do everything", async () => {
    const org = await createOrg("Active Co");
    await createTrialSubscription(org); // trialing, in-window
    const e = await getEntitlements(org);
    expect(e.billingActive).toBe(true);
    expect(e.canUseLiveAI).toBe(true);
    expect(e.canGeneratePMsWithAI).toBe(true);
    expect(e.canGenerateScenariosWithAI).toBe(true);
    expect(e.canUploadFiles).toBe(true);
    expect(e.canInviteUsers).toBe(true);
    // Safety-critical always on:
    expect(e.canCreateManualWorkOrders).toBe(true);
    expect(e.canCreateManualHandoverNotes).toBe(true);
    expect(e.canViewExistingMaintenanceHistory).toBe(true);
  });
});

describe("entitlements — PAST_DUE org (payment failure grace)", () => {
  beforeAll(async () => { await ensureDb(); });

  it("keeps manual + read workflows, disables AI/upload/invite", async () => {
    const org = await createOrg("PastDue Co");
    await createTrialSubscription(org);
    await setStatus(org, "past_due");
    const e = await getEntitlements(org);

    // Read + manual stay ON (safety-critical, never blocked):
    expect(e.canViewExistingMaintenanceHistory).toBe(true);
    expect(e.canCreateManualWorkOrders).toBe(true);        // manual WO update/close
    expect(e.canCreateManualHandoverNotes).toBe(true);     // manual handoff note

    // AI + growth turn OFF:
    expect(e.canUseLiveAI).toBe(false);
    expect(e.canGeneratePMsWithAI).toBe(false);            // AI PM generation blocked
    expect(e.canGenerateScenariosWithAI).toBe(false);      // AI scenario generation blocked
    expect(e.canUploadFiles).toBe(false);                  // new uploads blocked
    expect(e.canInviteUsers).toBe(false);                  // inviting users blocked
    expect(e.reasons.ai).toMatch(/billing/i);
  });

  it("canceled org behaves the same (grace, not lockout)", async () => {
    const org = await createOrg("Canceled Co");
    await createTrialSubscription(org);
    await setStatus(org, "canceled");
    const e = await getEntitlements(org);
    expect(e.canViewExistingMaintenanceHistory).toBe(true);
    expect(e.canCreateManualWorkOrders).toBe(true);
    expect(e.canUseLiveAI).toBe(false);
    expect((await uploadEntitlement(org, 1)).allowed).toBe(false);
    expect((await inviteEntitlement(org)).allowed).toBe(false);
  });

  it("aiEntitlement reports the grace reason (no silent block)", async () => {
    const org = await createOrg("Reason Co");
    await createTrialSubscription(org);
    await setStatus(org, "past_due");
    const ai = await aiEntitlement(org);
    expect(ai.allowed).toBe(false);
    expect(ai.reason).toMatch(/paused while billing is inactive/i);
  });
});

describe("entitlements — RBAC + no-Stripe fail-open", () => {
  it("technician has no billing complexity (cannot manage billing)", () => {
    expect(can("technician", "manage_billing")).toBe(false);
    expect(can("viewer", "manage_billing")).toBe(false);
  });

  it("no-Stripe deployment fails open (nothing gated)", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await ensureDb();
    const org = await createOrg("NoStripe Co");
    await createTrialSubscription(org);
    await setStatus(org, "past_due"); // even past_due — but no Stripe → fail-open
    const e = await getEntitlements(org);
    expect(e.billingActive).toBe(true);
    expect(e.canUseLiveAI).toBe(true);
    expect(e.canUploadFiles).toBe(true);
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy"; // restore for any later files
  });
});
