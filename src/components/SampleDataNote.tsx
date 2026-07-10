"use client";

import { useEffect, useState } from "react";
import { isDemoOrg, type OrgLike } from "@/lib/orgs/isDemoOrg";

// Small "sample demo data" disclaimer for the high-risk proof pages (Reliability
// Command Center, Pilot Value / ROI, Knowledge Reuse Impact) where populated
// dollar/downtime metrics could otherwise be mistaken for a customer's real
// results. Print-visible (the leadership PDF must carry the label too).
export function SampleDataNote({ className = "" }: { className?: string }) {
  return (
    <span
      role="note"
      className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--color-amber)]/40 bg-[color-mix(in_srgb,var(--color-amber)_12%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-amber)] print:border-neutral-400 print:bg-transparent print:text-neutral-600 ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)] print:bg-neutral-500 shrink-0" />
      Sample demo data — not customer production results.
    </span>
  );
}

// Client wrapper for pages that don't already know the org server-side (ROI,
// Reuse Impact). Fetches the current org and renders the note only in the demo
// workspace.
export function SampleDataNoteAuto({ className = "" }: { className?: string }) {
  const [org, setOrg] = useState<OrgLike | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setOrg(d?.org ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!isDemoOrg(org)) return null;
  return <SampleDataNote className={className} />;
}
