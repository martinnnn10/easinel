"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { Markdown } from "@/components/Markdown";

interface Digest {
  generatedAt: number;
  windowHours: number;
  stats: { open: number; inProgress: number; onHold: number; closedThisShift: number; pendingRequests: number; pmsDue: number };
  machinesDown: { id: string; name: string }[];
  watchItems: string[];
  markdown: string;
}

export default function HandoverPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [hours, setHours] = useState(12);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback((h: number) => {
    setLoading(true);
    return fetch(`/api/handover?hours=${h}`)
      .then((r) => r.json())
      .then((d) => setDigest(d.digest ?? null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(hours); }, [load, hours]);

  const copy = async () => {
    if (!digest) return;
    try { await navigator.clipboard.writeText(digest.markdown); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  const S = digest?.stats;
  return (
    <>
      <TopBar
        title="Shift Handover"
        subtitle="End-of-shift briefing — generated from live board data"
        right={
          <div className="flex items-center gap-2">
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="text-[12px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1.5">
              <option value={8}>Last 8h</option>
              <option value={12}>Last 12h</option>
              <option value={24}>Last 24h</option>
            </select>
            <button onClick={copy} className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110">
              {copied ? "Copied ✓" : "Copy digest"}
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="grid grid-cols-3 gap-2.5">{[0,1,2,3,4,5].map((i)=><div key={i} className="h-16 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]"/>)}</div>
              <div className="h-64 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]" />
            </div>
          ) : digest ? (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 mb-5">
                <Kpi label="Open" value={S!.open} />
                <Kpi label="In progress" value={S!.inProgress} />
                <Kpi label="On hold" value={S!.onHold} tone={S!.onHold ? "amber" : undefined} />
                <Kpi label="Down" value={digest.machinesDown.length} tone={digest.machinesDown.length ? "red" : undefined} />
                <Kpi label="Requests" value={S!.pendingRequests} tone={S!.pendingRequests ? "amber" : undefined} />
                <Kpi label="PMs due" value={S!.pmsDue} />
              </div>

              {/* Watch items */}
              <div className="rounded-xl border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/[0.06] p-4 mb-5">
                <p className="text-[11px] uppercase tracking-wider text-[var(--color-amber)] mb-2">Watch items for next shift</p>
                <ul className="space-y-1">
                  {digest.watchItems.map((w, i) => <li key={i} className="text-[13px]">• {w}</li>)}
                </ul>
              </div>

              {/* Full digest */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[13.5px] leading-relaxed">
                <Markdown>{digest.markdown}</Markdown>
              </div>
            </>
          ) : (
            <p className="text-[var(--color-muted)] text-sm">Couldn’t load the digest.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const color = tone === "red" ? "var(--color-red)" : tone === "amber" ? "var(--color-amber)" : "var(--color-text)";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</p>
      <p className="text-[20px] font-semibold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}
