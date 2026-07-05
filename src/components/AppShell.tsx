"use client";

import { usePathname } from "next/navigation";
import { BillingBanner } from "./SubscriptionGate";
import { AiProviderBanner } from "./AiProviderBanner";

/**
 * Client-side shell. Surfaces the AI-provider fallback banner and the billing
 * grace banner. IMPORTANT: a failed/canceled subscription does NOT block access
 * — maintenance data stays readable (grace model); live AI is throttled
 * server-side instead. So there is no hard redirect here.
 *
 * The banners are app chrome: they never render on the public marketing site
 * (/) or the login screen, where an anonymous visitor would otherwise see
 * internal operational warnings.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isPublic = path === "/" || path === "/privacy" || path === "/terms" || path.startsWith("/login");
  return (
    <>
      {!isPublic && <BillingBanner />}
      {!isPublic && <AiProviderBanner />}
      {children}
    </>
  );
}
