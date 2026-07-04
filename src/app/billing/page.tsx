"use client";

import { useEffect, useState } from "react";

interface BillingData {
  subscription: {
    plan: string;
    status: string;
    trialDaysRemaining: number;
    trialEndsAt: number | null;
    currentPeriodEnd: number | null;
    hasStripe: boolean;
  } | null;
  active: boolean;
  stripeConfigured: boolean;
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Failed to load billing info"))
      .finally(() => setLoading(false));
  }, []);

  const handleCheckout = async () => {
    setActionLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "checkout" }),
      });
      const d = await res.json();
      if (d.url) {
        window.location.href = d.url;
      } else {
        setError(d.message || "Failed to create checkout session");
      }
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePortal = async () => {
    setActionLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "portal" }),
      });
      const d = await res.json();
      if (d.url) {
        window.location.href = d.url;
      } else {
        setError(d.message || "Failed to open portal");
      }
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--color-bg)]">
        <p className="text-[var(--color-muted)] text-sm">Loading billing…</p>
      </div>
    );
  }

  const sub = data?.subscription;
  const isTrialing = sub?.status === "trialing";
  const isActive = sub?.status === "active" || sub?.status === "grandfathered";
  const isExpired = !data?.active;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] px-4 py-12">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold shadow-lg shadow-black/40">
            E
          </div>
          <div className="text-[15px] font-semibold tracking-tight">EAS Intelligence</div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
          <h1 className="text-[20px] font-semibold mb-2">Subscription & Billing</h1>

          {!sub && (
            <div className="mt-4">
              <p className="text-[13px] text-[var(--color-muted)] mb-4">
                No subscription found for your organization. Contact support or sign up for a plan.
              </p>
            </div>
          )}

          {sub && isTrialing && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-[13px] font-medium text-yellow-600">Free Trial</span>
              </div>
              <p className="text-[13px] text-[var(--color-muted)] mb-1">
                Your 14-day free trial {isExpired ? "has expired" : "is active"}.
              </p>
              {!isExpired && (
                <p className="text-[24px] font-bold text-[var(--color-text)] mb-1">
                  {sub.trialDaysRemaining} days remaining
                </p>
              )}
              {isExpired && (
                <p className="text-[14px] text-[var(--color-red)] font-medium mb-4">
                  Your trial has expired. Subscribe to continue using EAS Intelligence.
                </p>
              )}
            </div>
          )}

          {sub && isActive && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                <span className="text-[13px] font-medium text-green-600">
                  {sub.status === "grandfathered" ? "Lifetime Access" : "Active"}
                </span>
              </div>
              <p className="text-[13px] text-[var(--color-muted)]">
                {sub.status === "grandfathered"
                  ? "Your organization has permanent access to EAS Intelligence."
                  : `Plan: ${sub.plan.toUpperCase()} · Renews ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—"}`}
              </p>
            </div>
          )}

          {sub?.status === "past_due" && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                <span className="text-[13px] font-medium text-red-600">Payment Past Due</span>
              </div>
              <p className="text-[13px] text-[var(--color-muted)] mb-4">
                Your last payment failed. Please update your payment method to avoid service interruption.
              </p>
            </div>
          )}

          {sub?.status === "canceled" && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-[13px] font-medium text-gray-600">Canceled</span>
              </div>
              <p className="text-[13px] text-[var(--color-muted)] mb-4">
                Your subscription has been canceled. Subscribe again to regain access.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 space-y-3">
            {data?.stripeConfigured && (isExpired || isTrialing || sub?.status === "canceled") && (
              <button
                onClick={handleCheckout}
                disabled={actionLoading}
                className="w-full text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-3 hover:brightness-110 disabled:opacity-40"
              >
                {actionLoading ? "Redirecting…" : "Subscribe — $99/month"}
              </button>
            )}

            {data?.stripeConfigured && sub?.hasStripe && isActive && (
              <button
                onClick={handlePortal}
                disabled={actionLoading}
                className="w-full text-[13px] font-medium rounded-lg border border-[var(--color-border)] py-3 hover:bg-[var(--color-surface-2)] disabled:opacity-40"
              >
                {actionLoading ? "Redirecting…" : "Manage Subscription"}
              </button>
            )}

            {!data?.stripeConfigured && isExpired && (
              <div className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] p-4">
                <p className="text-[13px] text-[var(--color-muted)] mb-2">
                  Online payment is being set up. To activate your account, contact:
                </p>
                <a
                  href="mailto:eas@eautomatedstaffing.com"
                  className="text-[13px] font-medium text-[var(--color-accent)] hover:underline"
                >
                  eas@eautomatedstaffing.com
                </a>
              </div>
            )}
          </div>

          {error && <p className="text-[12px] text-[var(--color-red)] mt-3">{error}</p>}

          {/* Plan details */}
          <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
            <h2 className="text-[14px] font-semibold mb-3">EAS Intelligence Pro</h2>
            <ul className="space-y-2 text-[12px] text-[var(--color-muted)]">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Unlimited AI-powered maintenance copilot conversations</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Knowledge base with OCR extraction & inline viewer</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Work order lifecycle with Root Cause Analysis</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>AI-generated PM programs with structured procedures</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>KPI dashboard with MTTR, MTBF, and compliance metrics</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>PLC program explorer & shift handover reports</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Team management with role-based access control</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Enterprise SSO (OIDC) support</span>
              </li>
            </ul>
          </div>
        </div>

        <p className="text-center text-[11px] text-[var(--color-faint)] mt-4">
          Questions? Contact <a href="mailto:eas@eautomatedstaffing.com" className="underline">eas@eautomatedstaffing.com</a>
        </p>
      </div>
    </div>
  );
}
