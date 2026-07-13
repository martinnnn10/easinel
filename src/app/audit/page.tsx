"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface Entry {
  id: string;
  at: number;
  actorName: string;
  action: string;
  label: string;
  category: string;
  target: string | null;
  detail: string | null;
}

const CAT_LABEL: Record<string, string> = {
  work_order: "Work orders", pm: "PMs", asset: "Assets", part: "Parts",
  knowledge: "Knowledge", admin: "Admin", integration: "Integrations", system: "System", other: "Other",
};
const CAT_COLOR: Record<string, string> = {
  work_order: "var(--color-accent)", pm: "var(--color-green)", asset: "var(--color-amber)",
  part: "var(--color-muted)", knowledge: "var(--color-accent)", admin: "var(--color-red)",
  integration: "var(--color-green)", system: "var(--color-faint)", other: "var(--color-faint)",
};

function fmt(ts: number) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [days, setDays] = useState(30);
  const [cat, setCat] = useState("");

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ days: String(days), limit: "500" });
    if (cat) qs.set("category", cat);
    fetch(`/api/audit?${qs.toString()}`)
      .then((r) => { if (r.status === 401 || r.status === 403) { setForbidden(true); return null; } return r.json(); })
      .then((d) => d && setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days, cat]);

  const exportUrl = (() => {
    const qs = new URLSearchParams({ days: String(days) });
    if (cat) qs.set("category", cat);
    return `/api/audit/export?${qs.toString()}`;
  })();

  return (
    <>
      <TopBar
        title="Audit Trail"
        subtitle="Every recorded action — who did what, when — for compliance and traceability"
        right={
          !forbidden && (
            <a href={exportUrl} className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]">
              Export CSV
            </a>
          )
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {loading ? (
            <div className="h-40 rounded-2xl bg-[var(--color-surface-2)] animate-pulse" />
          ) : forbidden ? (
            <div className="text-center py-20">
              <div className="text-3xl mb-3">🔒</div>
              <p className="text-[15px] font-medium">Audit Trail is for managers &amp; admins</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-sm mx-auto">The activity log is available to your organization&apos;s managers, admins, and owner.</p>
              <Link href="/today" className="inline-block mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 hover:brightness-110">Back to Today</Link>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="text-[12px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                  <option value={365}>Last year</option>
                </select>
                <select value={cat} onChange={(e) => setCat(e.target.value)} className="text-[12px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 capitalize">
                  <option value="">All activity</option>
                  {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <span className="text-[12px] text-[var(--color-faint)] ml-auto">{entries.length} events</span>
              </div>

              {entries.length === 0 ? (
                <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
                  <p className="text-[15px] font-medium">No recorded activity in this window</p>
                  <p className="text-[var(--color-muted)] text-sm mt-1">As your team logs work, approves PMs, and manages equipment, every action lands here.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                  {entries.map((e, i) => (
                    <div key={e.id} className={`flex items-start gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
                      <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: CAT_COLOR[e.category] ?? "var(--color-faint)" }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px]">
                          <strong className="font-medium">{e.actorName}</strong>{" "}
                          <span className="text-[var(--color-muted)]">{e.label.toLowerCase()}</span>
                        </p>
                        {e.detail && <p className="text-[11px] text-[var(--color-faint)] truncate">{safeDetail(e.detail)}</p>}
                      </div>
                      <span className="text-[11px] text-[var(--color-faint)] shrink-0 whitespace-nowrap">{fmt(e.at)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[var(--color-faint)] mt-4 text-center">
                Append-only record. Every entry is a real action taken in your workspace — nothing is edited or removed.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Detail is stored as JSON or a short string; render a compact readable form.
function safeDetail(detail: string): string {
  try {
    const o = JSON.parse(detail);
    if (o && typeof o === "object") {
      return Object.entries(o)
        .filter(([, v]) => v != null && v !== "")
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(" · ");
    }
  } catch {
    /* plain string */
  }
  return detail.slice(0, 160);
}
