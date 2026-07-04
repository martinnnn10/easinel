import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent } from "@/lib/billing/stripe";
import {
  updateSubscriptionFromStripe,
  recordStripeEvent,
  findOrgByStripeSubscription,
  type SubStatus,
} from "@/lib/billing/subscription";
import { planFromStripePrice } from "@/lib/billing/stripeMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // Stripe sends a raw body — no parsing.

function mapStatus(s: string): SubStatus {
  if (s === "past_due") return "past_due";
  if (s === "canceled" || s === "unpaid") return "canceled";
  if (s === "trialing") return "trialing";
  return "active";
}

// Pull the first line-item price id off a Stripe subscription object.
function priceIdOf(sub: Record<string, unknown>): string | null {
  const items = (sub.items as { data?: { price?: { id?: string } }[] } | undefined)?.data;
  return items?.[0]?.price?.id ?? null;
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event;
  try {
    const body = await req.text();
    event = await constructWebhookEvent(body, signature); // verifies the signing secret
  } catch (err: unknown) {
    console.error("[billing/webhook] Signature verification failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // IDEMPOTENCY — store the event id; a redelivered event is acknowledged as a
  // no-op so retries never double-apply a subscription change.
  const fresh = await recordStripeEvent(event.id, event.type);
  if (!fresh) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as unknown as Record<string, unknown>;
        const orgId = (session.metadata as Record<string, string>)?.orgId;
        if (orgId) {
          await updateSubscriptionFromStripe(orgId, {
            status: "active",
            // Plan is finalized by the subscription.updated event (which carries
            // the price); default to professional until then.
            plan: "professional",
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as Record<string, unknown>;
        // Prefer metadata.orgId (set at checkout); else resolve by subscription id.
        let orgId: string | null = (sub.metadata as Record<string, string>)?.orgId ?? null;
        if (!orgId && typeof sub.id === "string") orgId = await findOrgByStripeSubscription(sub.id);
        if (orgId) {
          const plan = planFromStripePrice(priceIdOf(sub)); // Stripe price → internal plan code
          await updateSubscriptionFromStripe(orgId, {
            status: event.type === "customer.subscription.deleted" ? "canceled" : mapStatus(sub.status as string),
            plan,
            currentPeriodEnd: sub.current_period_end ? (sub.current_period_end as number) * 1000 : undefined,
            stripeSubscriptionId: typeof sub.id === "string" ? sub.id : undefined,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as unknown as Record<string, unknown>;
        const subId = invoice.subscription as string;
        // Mark past_due immediately (grace) — data stays readable; live AI throttles.
        const orgId = subId ? await findOrgByStripeSubscription(subId) : null;
        if (orgId) await updateSubscriptionFromStripe(orgId, { status: "past_due" });
        break;
      }

      default:
        break; // acknowledge unhandled types
    }
  } catch (err) {
    console.error("[billing/webhook] Error processing event:", err);
    return NextResponse.json({ error: "processing_error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
