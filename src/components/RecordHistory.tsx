"use client";

import { useEffect, useState } from "react";

// Per-record change history — a compact "who did what, when" timeline for a
// single work order or PM, read from the append-only audit trail. Only renders
// for managers+ (the API is manage_workforce-gated; a 403 hides the section).
// Nothing is invented: it shows exactly the recorded actions for this target.
interface Entry {
  id: string;
  at: number;
  actorName: string;
  label: string;
  category: string;
}

export function RecordHistory({ target, title = "Activity" }: { target: string; title?: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/audit?target=${encodeURIComponent(target)}&limit=50`)
      .then((r) => {
        if (r.status === 401 || r.status === 403) { setHidden(true); return null; }
        return r.json();
      })
      .then((d) => { if (live && d) setEntries(d.entries ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [target]);

  if (hidden || !entries || entries.length === 0) return null;

  return (
    <section className="mt-5">
      <h2 className="text-[12px] uppercase tracking-wide text-[var(--color-muted)] mb-2">{title}</h2>
      <ol className="relative border-l border-[var(--color-border)] ml-1.5 space-y-3 pl-4">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-bg)]" />
            <p className="text-[13px]">
              <strong className="font-medium">{e.actorName}</strong>{" "}
              <span className="text-[var(--color-muted)]">{e.label.toLowerCase()}</span>
            </p>
            <p className="text-[11px] text-[var(--color-faint)]">
              {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
