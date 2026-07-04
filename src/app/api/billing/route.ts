import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import {
  getSubscription,
  hasActiveAccess,
  trialDaysRemaining,
  stripeConfigured,
} from "@/lib/billing/subscription";
import { createCheckoutSession, createPortalSession, isStripeConfigured } from "@/lib/billing/stripe";
import { getOrg } from "@/lib/auth/session";

export const runtime = "nodejs";

// GET /api/billing — return current subscription status for the org.
export const GET = safeHandler("billing.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const sub = await getSubscription(orgId);
  const active = await hasActiveAccess(orgId);
  return NextResponse.json({
    subscription: sub
      ? {
          plan: sub.plan,
          status: sub.status,
          trialDaysRemaining: trialDaysRemaining(sub),
          trialEndsAt: sub.trialEndsAt,
          currentPeriodEnd: sub.currentPeriodEnd,
          hasStripe: Boolean(sub.stripeCustomerId),
        }
      : null,
    active,
    stripeConfigured: stripeConfigured(),
  });
});

// POST /api/billing — create a Stripe Checkout session or portal session.
export const POST = safeHandler("billing.post", async (req: NextRequest) => {
  const gate = await requirePermission("manage_billing");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const { action } = await req.json().catch(() => ({ action: "" }));

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "stripe_not_configured", message: "Stripe is not configured. Contact support." },
      { status: 503 }
    );
  }

  const baseUrl = process.env.APP_BASE_URL || "https://easmaint.com";

  if (action === "checkout") {
    const org = await getOrg(orgId);
    const url = await createCheckoutSession({
      orgId,
      orgName: org?.name || "Organization",
      email: gate.user.email,
      successUrl: `${baseUrl}/billing?success=true`,
      cancelUrl: `${baseUrl}/billing?canceled=true`,
    });
    return NextResponse.json({ url });
  }

  if (action === "portal") {
    const sub = await getSubscription(orgId);
    if (!sub?.stripeCustomerId) {
      return NextResponse.json(
        { error: "no_customer", message: "No Stripe customer found. Subscribe first." },
        { status: 400 }
      );
    }
    const url = await createPortalSession(sub.stripeCustomerId, `${baseUrl}/billing`);
    return NextResponse.json({ url });
  }

  return NextResponse.json({ error: "bad_request", message: "Invalid action" }, { status: 400 });
});
