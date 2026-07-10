"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { shouldShowDemoBanner, type OrgLike } from "@/lib/orgs/isDemoOrg";

// App-shell banner shown only inside the labeled demo workspace, so a viewer
// always knows the populated metrics are sample data — never a real customer's
// production results. Screen chrome only (hidden in print; the proof pages carry
// their own print-visible note). Never renders on the public site / auth / field
// routes (shouldShowDemoBanner handles that).
export function DemoBanner() {
  const path = usePathname();
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
  }, [path]);

  if (!shouldShowDemoBanner(org, path)) return null;

  return (
    <div
      role="note"
      className="print:hidden shrink-0 flex items-center justify-center gap-2 border-b border-[var(--color-amber)]/30 bg-[color-mix(in_srgb,var(--color-amber)_11%,var(--color-surface))] px-4 py-1.5 text-[var(--color-amber)]"
    >
      <FlaskIcon className="w-3.5 h-3.5 shrink-0" />
      <p className="text-[12px] leading-tight">
        <span className="font-semibold">Demo Workspace</span>
        <span className="hidden sm:inline">
          {" "}
          — sample data for product walkthroughs. Do not treat these metrics as customer production results.
        </span>
        <span className="sm:hidden"> — sample data</span>
      </p>
    </div>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3" />
      <path d="M7 15h10" />
    </svg>
  );
}
