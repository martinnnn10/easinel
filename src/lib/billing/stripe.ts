/**
 * Stripe integration helpers.
 * Only active when STRIPE_SECRET_KEY is set in env.
 */

import Stripe from "stripe";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Create a Stripe Checkout session for a new subscription.
 * Returns the checkout URL to redirect the user to.
 */
export async function createCheckoutSession(opts: {
  orgId: string;
  orgName: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
  planKey?: string; // which plan to subscribe to (defaults to professional)
}): Promise<string> {
  const stripe = getStripe();
  // Use a REAL configured Stripe price for the target plan. NEVER create an
  // ad-hoc / fake price — if none is configured, the operator hasn't finished
  // Stripe setup and we must not invent pricing.
  const { stripePriceForPlan } = await import("./stripeMap");
  const priceId = stripePriceForPlan(opts.planKey || "professional");
  if (!priceId) {
    throw new Error("billing_not_configured");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: opts.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { orgId: opts.orgId, orgName: opts.orgName },
    subscription_data: { metadata: { orgId: opts.orgId } },
  });

  return session.url!;
}

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/**
 * Verify and parse a Stripe webhook event.
 */
export async function constructWebhookEvent(
  body: string | Buffer,
  signature: string
): Promise<Stripe.Event> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  return stripe.webhooks.constructEvent(body, signature, secret);
}
