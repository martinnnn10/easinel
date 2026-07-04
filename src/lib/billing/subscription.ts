/**
 * Subscription / billing module.
 *
 * Plans:
 *   - free_trial: 14-day trial, full access, auto-created on signup
 *   - pro: paid monthly plan ($99/mo suggested)
 *   - enterprise: custom pricing
 *
 * Statuses:
 *   - trialing: within trial window
 *   - active: paid and current
 *   - past_due: payment failed, grace period
 *   - canceled: subscription ended
 *   - grandfathered: permanent access (for the original owner)
 */

import { db, ensureDb } from "@/lib/db";
import { subscriptions, stripeEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id } from "@/lib/util";

export type Plan = "free_trial" | "pro" | "enterprise";
export type SubStatus = "trialing" | "active" | "past_due" | "canceled" | "grandfathered";

export interface Subscription {
  id: string;
  orgId: string;
  plan: Plan;
  status: SubStatus;
  trialEndsAt: number | null;
  currentPeriodEnd: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
}

const TRIAL_DAYS = 14;

/** Create a free trial subscription for a new org. */
export async function createTrialSubscription(orgId: string): Promise<Subscription> {
  await ensureDb();
  const now = Date.now();
  const trialEnd = now + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const subId = id("sub");
  await db.insert(subscriptions).values({
    id: subId,
    orgId,
    plan: "free_trial",
    status: "trialing",
    trialEndsAt: trialEnd,
    currentPeriodEnd: trialEnd,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });
  return {
    id: subId,
    orgId,
    plan: "free_trial",
    status: "trialing",
    trialEndsAt: trialEnd,
    currentPeriodEnd: trialEnd,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date(now),
  };
}

/** Create a grandfathered (permanent) subscription for the original owner. */
export async function createGrandfatheredSubscription(orgId: string): Promise<void> {
  await ensureDb();
  const existing = await getSubscription(orgId);
  if (existing) return; // already has one
  await db.insert(subscriptions).values({
    id: id("sub"),
    orgId,
    plan: "pro",
    status: "grandfathered",
    trialEndsAt: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  });
}

/** Get the subscription for an org. */
export async function getSubscription(orgId: string): Promise<Subscription | null> {
  await ensureDb();
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    orgId: r.orgId,
    plan: r.plan as Plan,
    status: r.status as SubStatus,
    trialEndsAt: r.trialEndsAt,
    currentPeriodEnd: r.currentPeriodEnd,
    stripeCustomerId: r.stripeCustomerId,
    stripeSubscriptionId: r.stripeSubscriptionId,
    createdAt: r.createdAt,
  };
}

/** Check if an org has active access (trialing within window, active, or grandfathered). */
export async function hasActiveAccess(orgId: string): Promise<boolean> {
  // Fail OPEN until Stripe is actually configured: the paywall must never lock a
  // deployment out of its own core product just because billing isn't set up.
  // Enforcement begins only once STRIPE_SECRET_KEY is present.
  if (!stripeConfigured()) return true;
  const sub = await getSubscription(orgId);
  if (!sub) return false;
  if (sub.status === "active" || sub.status === "grandfathered") return true;
  if (sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt > Date.now()) return true;
  return false;
}

/** Update subscription from Stripe webhook data. Server-side only (webhook). */
export async function updateSubscriptionFromStripe(
  orgId: string,
  data: {
    status: SubStatus;
    plan?: string; // internal plan code (mapped from the Stripe price)
    currentPeriodEnd?: number;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  }
): Promise<void> {
  await ensureDb();
  // Ensure a row exists (checkout may land before any trial row was created).
  const existing = await getSubscription(orgId);
  if (!existing) {
    await db.insert(subscriptions).values({
      id: id("sub"),
      orgId,
      plan: data.plan ?? "professional",
      status: data.status,
      trialEndsAt: null,
      currentPeriodEnd: data.currentPeriodEnd ?? null,
      stripeCustomerId: data.stripeCustomerId ?? null,
      stripeSubscriptionId: data.stripeSubscriptionId ?? null,
    });
    return;
  }
  const updates: Record<string, unknown> = { status: data.status };
  if (data.plan) updates.plan = data.plan;
  if (data.currentPeriodEnd) updates.currentPeriodEnd = data.currentPeriodEnd;
  if (data.stripeCustomerId) updates.stripeCustomerId = data.stripeCustomerId;
  if (data.stripeSubscriptionId) updates.stripeSubscriptionId = data.stripeSubscriptionId;
  await db.update(subscriptions).set(updates).where(eq(subscriptions.orgId, orgId));
}

// Idempotency: record a Stripe event id; returns TRUE if it is NEW (should be
// processed), FALSE if already seen (redelivery → no-op).
export async function recordStripeEvent(eventId: string, type: string): Promise<boolean> {
  await ensureDb();
  const res = await db
    .insert(stripeEvents)
    .values({ id: eventId, type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  return res.length > 0;
}

// Find which org a Stripe subscription id belongs to (for events lacking
// metadata, e.g. invoice.payment_failed).
export async function findOrgByStripeSubscription(subId: string): Promise<string | null> {
  await ensureDb();
  const rows = await db
    .select({ orgId: subscriptions.orgId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId));
  return rows[0]?.orgId ?? null;
}

/** Check if Stripe is configured. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Get the number of days remaining in trial. */
export function trialDaysRemaining(sub: Subscription): number {
  if (sub.status !== "trialing" || !sub.trialEndsAt) return 0;
  const remaining = Math.ceil((sub.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}
