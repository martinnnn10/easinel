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
}): Promise<string> {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PRICE_ID;

  // If a specific price ID is configured, use it. Otherwise create an ad-hoc price.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = priceId
    ? [{ price: priceId, quantity: 1 }]
    : [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "EAS Intelligence Pro",
              description: "Manufacturing Intelligence Platform — per organization",
            },
            unit_amount: 9900, // $99.00/mo
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ];

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: opts.email,
    line_items: lineItems,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: {
      orgId: opts.orgId,
      orgName: opts.orgName,
    },
    subscription_data: {
      metadata: { orgId: opts.orgId },
    },
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
