"use client";

import { useSubscriptionCheck } from "./SubscriptionGate";
import { AiProviderBanner } from "./AiProviderBanner";

/**
 * Client-side shell that performs the subscription check on mount.
 * If the org has no active subscription, redirects to /billing.
 * Renders children immediately (fail-open UX — no flash of blank page).
 * Also surfaces the AI-provider fallback banner so a silent fallback is visible.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  useSubscriptionCheck();
  return (
    <>
      <AiProviderBanner />
      {children}
    </>
  );
}
