"use client";

import { useState } from "react";

// One-tap "draft a preventive program from this recurring failure". Shared by the
// Shift Handover repeat-risk rows and the machine detail Failures banner so the
// detection → prevention path is identical everywhere. Managers (manage_pm) get
// the draft action; everyone else gets an optional navigation fallback. The draft
// is created via the same server-gated /api/pm/suggest flow (draft only, never
// active), so nothing here can escalate privileges or fabricate an active PM.
export function SuggestPmButton({
  workOrderId,
  canManagePm,
  onFallback,
  fallbackLabel = "Plan a PM →",
  size = "md",
}: {
  workOrderId: string;
  canManagePm: boolean;
  onFallback?: () => void;
  fallbackLabel?: string;
  size?: "sm" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [drafted, setDrafted] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pad = size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1.5 text-[12px]";
  const solid = `shrink-0 font-medium rounded-lg ${pad} bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:brightness-110 disabled:opacity-50`;

  if (drafted) {
    return (
      <a href={`/pm/${drafted}`} className={`shrink-0 font-medium ${size === "sm" ? "text-[10.5px]" : "text-[12px]"} text-[var(--color-green)] hover:underline`}>
        PM drafted — review →
      </a>
    );
  }

  if (!canManagePm) {
    // Non-managers can't draft PMs; offer the navigation fallback if given.
    return onFallback ? (
      <button onClick={onFallback} className={solid}>{fallbackLabel}</button>
    ) : null;
  }

  const suggest = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/pm/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workOrderId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.program?.id) setDrafted(d.program.id);
      else setErr(d.message || "Couldn't draft a PM.");
    } catch {
      setErr("Couldn't draft a PM.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-2">
      {err && <span className={`${size === "sm" ? "text-[10.5px]" : "text-[11px]"} text-[var(--color-red)]`}>{err}</span>}
      <button onClick={suggest} disabled={busy} className={solid}>
        {busy ? "Drafting…" : "Suggest PM →"}
      </button>
    </div>
  );
}
