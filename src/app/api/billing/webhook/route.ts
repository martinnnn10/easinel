import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent } from "@/lib/billing/stripe";
import { updateSubscriptionFromStripe, getSubscription } from "@/lib/billing/subscription";
import type { SubStatus } from "@/lib/billing/subscription";

export const runtime = "nodejs";

// Stripe sends raw body — disable Next.js body parsing.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event;
  try {
    const body = await req.text();
    event = await constructWebhookEvent(body, signature);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[billing/webhook] Signature verification failed:", msg);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as unknown as Record<string, unknown>;
        const orgId = (session.metadata as Record<string, string>)?.orgId;
        if (orgId) {
          await updateSubscriptionFromStripe(orgId, {
            status: "active",
            plan: "pro",
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as unknown as Record<string, unknown>;
        const orgId = (sub.metadata as Record<string, string>)?.orgId;
        if (orgId) {
          const stripeStatus = sub.status as string;
          let status: SubStatus = "active";
          if (stripeStatus === "past_due") status = "past_due";
          else if (stripeStatus === "canceled" || stripeStatus === "unpaid") status = "canceled";
          else if (stripeStatus === "trialing") status = "trialing";

          await updateSubscriptionFromStripe(orgId, {
            status,
            currentPeriodEnd: sub.current_period_end
              ? (sub.current_period_end as number) * 1000
              : undefined,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as unknown as Record<string, unknown>;
        const subId = invoice.subscription as string;
        // Look up which org this subscription belongs to
        // For now just log — the subscription.updated event will handle status
        console.warn("[billing/webhook] Payment failed for subscription:", subId);
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt.
        break;
    }
  } catch (err) {
    console.error("[billing/webhook] Error processing event:", err);
    return NextResponse.json({ error: "processing_error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
