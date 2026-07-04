"use client";

import { useEffect, useState } from "react";

/**
 * Payment-failure GRACE, not a lockout. When a subscription is past_due /
 * canceled we do NOT block access to existing maintenance data — safety-critical
 * history must stay readable. Instead we surface a persistent billing banner.
 * Live AI is separately throttled server-side (see canUseLive), so an unpaid org
 * degrades gracefully rather than losing its data.
 */
export function BillingBanner() {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    let ok = true;
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (path.startsWith("/billing") || path.startsWith("/login") || path.startsWith("/accept-invite")) return;
    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => {
        if (!ok) return;
        // Only warn on a REAL (Stripe) inactive subscription — never in no-Stripe
        // or trialing/active/grandfathered states.
        const s = d?.subscription?.status;
        const inactive = d?.active === false && (s === "past_due" || s === "canceled");
        if (inactive) { setStatus(s); setShow(true); }
      })
      .catch(() => {});
    return () => { ok = false; };
  }, []);

  if (!show) return null;
  return (
    <div className="w-full bg-[var(--color-red)]/10 border-b border-[var(--color-red)]/30 px-4 py-1.5 flex items-center gap-2 text-[12px]">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-red)]" />
      <span className="text-[var(--color-red)] font-medium">
        Subscription {status === "past_due" ? "payment past due" : "canceled"}.
      </span>
      <span className="text-[var(--color-muted)]">
        Your maintenance data stays fully accessible; live AI is paused until billing is updated.
      </span>
      <a href="/billing" className="ml-auto text-[var(--color-text)] underline underline-offset-2 hover:text-[var(--color-red)]">Update billing</a>
    </div>
  );
}

// Back-compat: AppShell used to call a hook that redirected. It now no-ops (grace
// model — no hard lockout). Kept so existing imports don't break.
export function useSubscriptionCheck() {
  return true;
}
