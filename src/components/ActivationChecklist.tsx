"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Progress {
  hasAsset: boolean;
  hasDocument: boolean;
  hasCopilotChat: boolean;
  hasWorkOrder: boolean;
  hasClosedWithMemory: boolean;
  hasDowntimeRate: boolean;
  completed: number;
  total: number;
  done: boolean;
}

const DISMISS_KEY = "eas_activation_dismissed";

/**
 * The first-run activation checklist. Tracks the REAL milestones a new org
 * crosses toward first value — each check reflects actual data, not a stored
 * step. Self-hides once every milestone is met (or the user dismisses it), so it
 * guides without nagging. Reload-driven: it re-fetches whenever Today reloads.
 */
export function ActivationChecklist({
  onLaunchWizard,
  reloadKey,
}: {
  onLaunchWizard: () => void;
  reloadKey?: number;
}) {
  const [p, setP] = useState<Progress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(() => {
    fetch("/api/activation").then((r) => r.json()).then(setP).catch(() => {});
  }, []);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "1"); } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  if (!p || p.done || dismissed) return null;

  const steps: { key: keyof Progress; label: string; hint: string; href?: string; action?: () => void }[] = [
    { key: "hasAsset", label: "Add your first machine", hint: "Its history, failures, and a dedicated AI attach here.", action: onLaunchWizard },
    { key: "hasDocument", label: "Upload a manual or drawing", hint: "The Copilot cites YOUR documents by page.", href: "/knowledge" },
    { key: "hasCopilotChat", label: "Ask the Copilot a question", hint: "Grounded answers, even before you upload anything.", href: `/copilot?ask=${encodeURIComponent("A PowerFlex drive shows Fault F081 — what does it mean and what do I check?")}` },
    { key: "hasWorkOrder", label: "Log a work order", hint: "Capture the symptom the moment a machine goes down.", href: "/work-orders" },
    { key: "hasClosedWithMemory", label: "Close one with root cause + fix", hint: "This is the moment machine memory is created.", href: "/work-orders" },
    { key: "hasDowntimeRate", label: "Set your downtime rate", hint: "Turns downtime hours into dollars on Pilot Value.", href: "/dashboard" },
  ];

  const pct = Math.round((p.completed / p.total) * 100);

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-7">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Get to first value</h2>
          <p className="text-[13px] text-[var(--color-muted)] mt-1">
            {p.completed} of {p.total} done — each step builds the machine memory that makes EAS worth it.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!p.hasAsset && (
            <button
              onClick={onLaunchWizard}
              className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 hover:brightness-110"
            >
              Start guided setup · 2 min
            </button>
          )}
          <button
            onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } setDismissed(true); }}
            className="text-[11.5px] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        <div className="h-full bg-[var(--color-accent)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* Steps */}
      <div className="mt-4 grid sm:grid-cols-2 gap-2">
        {steps.map((s) => {
          const done = p[s.key] as boolean;
          const inner = (
            <div className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${
              done
                ? "border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/30"
                : "border-[var(--color-border-soft)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]"
            }`}>
              <span className={`mt-0.5 w-4 h-4 rounded-full shrink-0 grid place-items-center ${
                done ? "bg-[var(--color-green)] text-white" : "border border-[var(--color-border)]"
              }`}>
                {done && (
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5"/></svg>
                )}
              </span>
              <div className="min-w-0">
                <p className={`text-[13px] font-medium ${done ? "text-[var(--color-muted)] line-through" : ""}`}>{s.label}</p>
                {!done && <p className="text-[11.5px] text-[var(--color-muted)] mt-0.5 leading-snug">{s.hint}</p>}
              </div>
            </div>
          );
          if (done) return <div key={s.key}>{inner}</div>;
          if (s.action) return <button key={s.key} onClick={s.action} className="text-left w-full">{inner}</button>;
          return <Link key={s.key} href={s.href!}>{inner}</Link>;
        })}
      </div>
    </div>
  );
}
