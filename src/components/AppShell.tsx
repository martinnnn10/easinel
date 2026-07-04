"use client";

import { useSubscriptionCheck } from "./SubscriptionGate";

/**
 * Client-side shell that performs the subscription check on mount.
 * If the org has no active subscription, redirects to /billing.
 * Renders children immediately (fail-open UX — no flash of blank page).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  useSubscriptionCheck();
  return <>{children}</>;
}
