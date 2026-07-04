// Maps Stripe product/price IDs ⇄ internal plan codes. Configured entirely via
// env so Manus can wire the real Stripe catalog without code changes:
//
//   STRIPE_PRICE_PILOT=price_xxx
//   STRIPE_PRICE_PROFESSIONAL=price_xxx
//   STRIPE_PRICE_MULTISITE=price_xxx
//   STRIPE_PRICE_ENTERPRISE=price_xxx   (optional / custom)
//
// A Stripe price maps to exactly one internal plan code. Unknown prices fall back
// to "professional" so a paid customer is never left without access.

const PRICE_ENV: Record<string, string> = {
  pilot: "STRIPE_PRICE_PILOT",
  professional: "STRIPE_PRICE_PROFESSIONAL",
  multi_site: "STRIPE_PRICE_MULTISITE",
  enterprise: "STRIPE_PRICE_ENTERPRISE",
};

// Internal plan code → configured Stripe price id (or null if not configured).
export function stripePriceForPlan(planKey: string): string | null {
  const env = PRICE_ENV[planKey];
  return (env && process.env[env]) || null;
}

// True when at least one real Stripe price id is configured. The billing page
// uses this to decide between a real checkout button and the honest
// "Billing is not fully configured. Contact support." message.
export function hasAnyStripePrice(): boolean {
  return Object.values(PRICE_ENV).some((env) => Boolean(process.env[env]));
}

// Stripe price id → internal plan code. Unknown/unset → "professional".
export function planFromStripePrice(priceId: string | null | undefined): string {
  if (!priceId) return "professional";
  for (const [plan, env] of Object.entries(PRICE_ENV)) {
    if (process.env[env] && process.env[env] === priceId) return plan;
  }
  return "professional";
}
