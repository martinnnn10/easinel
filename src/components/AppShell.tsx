"use client";

import { BillingBanner } from "./SubscriptionGate";
import { AiProviderBanner } from "./AiProviderBanner";

/**
 * Client-side shell. Surfaces the AI-provider fallback banner and the billing
 * grace banner. IMPORTANT: a failed/canceled subscription does NOT block access
 * — maintenance data stays readable (grace model); live AI is throttled
 * server-side instead. So there is no hard redirect here.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BillingBanner />
      <AiProviderBanner />
      {children}
    </>
  );
}
