"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface RepeatFailure {
  assetId: string | null;
  assetName: string | null;
  label: string;
  count: number;
  downtimeHours: number;
  downtimeCost: number | null;
}
interface Kpis {
  mttrHours: number | null;
  pmCompliance: number | null;
  downtimeHours: number;
  downtimeCost: number | null;
  downtimeCostPerHour: number | null;
  downtimeDeltaPct: number | null;
}
interface PilotValue {
  periodDays: number;
  kpis: Kpis;
  capturedFixesPeriod: number;
  capturedFixesAllTime: number;
  lessonsIndexed: number;
  recurringCount: number;
  recurringDowntimeHours: number;
  recurringDowntimeCost: number | null;
  topRepeatFailures: RepeatFailure[];
  documentsIndexed: number;
  totalWorkOrders: number;
  closedWorkOrders: number;
  hasMemory: boolean;
  hasRecurring: boolean;
  hasDowntime: boolean;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
function periodLabel(d: number) {
  if (d <= 30) return "last 30 days";
  if (d <= 90) return "last 90 days";
  if (d <= 180) return "last 6 months";
  return "last year";
}

export default function RoiPage() {
  const [d, setD] = useState<PilotValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [period, setPeriod] = useState(90);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/roi?days=${period}`)
      .then((r) => {
        if (r.status === 401 || r.status === 403) { setForbidden(true); return null; }
        return r.json();
      })
      .then((j) => j && setD(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <>
      <TopBar
        title="Pilot Value"
        subtitle="What EAS has returned for your plant — computed only from your own records"
        right={
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="text-[12px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5"
          >
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
          </select>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {loading ? (
            <div className="h-40 rounded-2xl bg-[var(--color-surface-2)] animate-pulse" />
          ) : forbidden ? (
            <div className="text-center py-20">
              <div className="text-3xl mb-3">🔒</div>
              <p className="text-[15px] font-medium">Pilot Value is admin-only</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-sm mx-auto">
                The value summary is available to your organization&apos;s owner or admin.
              </p>
              <Link href="/today" className="inline-block mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 hover:brightness-110">
                Back to Today
              </Link>
            </div>
          ) : !d ? (
            <p className="text-[var(--color-muted)] text-sm">Couldn&apos;t load the value summary.</p>
          ) : (
            <>
              {/* Headline hero — the single number a buyer remembers */}
              <Hero d={d} />

              {/* The three value stories */}
              <div className="mt-6 grid md:grid-cols-3 gap-4">
                <StatCard
                  label="Machine memory captured"
                  value={d.capturedFixesAllTime}
                  unit={d.capturedFixesAllTime === 1 ? "documented fix" : "documented fixes"}
                  sub={
                    d.hasMemory
                      ? `${d.capturedFixesPeriod} in the ${periodLabel(d.periodDays)} · ${d.lessonsIndexed} lessons indexed`
                      : "Close a corrective work order with a root cause or repair to start"
                  }
                  tone={d.hasMemory ? "good" : "muted"}
                />
                <StatCard
                  label="Recurring failures surfaced"
                  value={d.recurringCount}
                  unit={d.recurringCount === 1 ? "repeat pattern" : "repeat patterns"}
                  sub={
                    d.hasRecurring
                      ? `${d.recurringDowntimeHours} h tied to repeats${d.recurringDowntimeCost != null ? ` · ${money(d.recurringDowntimeCost)}` : ""}`
                      : "EAS flags a machine's repeat faults once it fails the same way twice"
                  }
                  tone={d.hasRecurring ? "warn" : "muted"}
                />
                <StatCard
                  label="Plant knowledge grounded"
                  value={d.documentsIndexed}
                  unit={d.documentsIndexed === 1 ? "document searchable" : "documents searchable"}
                  sub={
                    d.documentsIndexed > 0
                      ? "Every Copilot answer can cite these by page"
                      : "Upload a manual or drawing to ground answers in your own docs"
                  }
                  tone={d.documentsIndexed > 0 ? "good" : "muted"}
                />
              </div>

              {/* Where the money leaks — ranked repeat offenders */}
              {d.hasRecurring && (
                <section className="mt-7">
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                    Where the money leaks — top repeat failures
                  </h2>
                  <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                    {d.topRepeatFailures.map((r, i) => (
                      <div
                        key={`${r.assetId}-${r.label}`}
                        className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}
                      >
                        <span className="w-6 h-6 rounded-full bg-[var(--color-amber)]/15 text-[var(--color-amber)] grid place-items-center text-[11px] font-semibold shrink-0">
                          {r.count}×
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate">
                            {r.assetName ?? "Unassigned"} · <span className="font-mono">{r.label}</span>
                          </p>
                          <p className="text-[11px] text-[var(--color-faint)]">
                            {r.downtimeHours} h of downtime across {r.count} events
                          </p>
                        </div>
                        {r.downtimeCost != null && (
                          <span className="text-[13px] font-semibold text-[var(--color-red)] shrink-0">{money(r.downtimeCost)}</span>
                        )}
                        {r.assetId && (
                          <Link href={`/assets/${r.assetId}?tab=failures`} className="text-[11px] font-medium text-[var(--color-accent)] shrink-0 hover:underline">
                            View →
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11.5px] text-[var(--color-faint)] mt-2">
                    Each of these is a PM waiting to be written. Turning one repeat into a scheduled
                    task is where a pilot pays for itself.
                  </p>
                </section>
              )}

              {/* Operational proof row */}
              <section className="mt-7">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                  Response &amp; discipline
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MiniKpi label="MTTR" value={d.kpis.mttrHours != null ? `${d.kpis.mttrHours}` : "—"} unit="h" sub="Mean time to repair" />
                  <MiniKpi label="PM compliance" value={d.kpis.pmCompliance != null ? `${d.kpis.pmCompliance}` : "—"} unit="%" sub="Scheduled PMs done" />
                  <MiniKpi label="Work orders closed" value={`${d.closedWorkOrders}`} sub={`of ${d.totalWorkOrders} total`} />
                  <MiniKpi label="Downtime" value={`${d.kpis.downtimeHours}`} unit="h" sub={periodLabel(d.periodDays)} />
                </div>
              </section>

              <p className="text-[11px] text-[var(--color-faint)] mt-8 text-center">
                Every figure on this page is computed from your organization&apos;s own work orders,
                documents, and PMs. Nothing is simulated or averaged from other plants.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Hero({ d }: { d: PilotValue }) {
  const rateSet = d.kpis.downtimeCostPerHour != null;
  const delta = d.kpis.downtimeDeltaPct;
  const deltaColor = delta == null || delta === 0 ? "var(--color-muted)" : delta < 0 ? "var(--color-green)" : "var(--color-red)";

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-surface-2)]/40 p-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        Downtime impact · {periodLabel(d.periodDays)}
      </p>
      {!d.hasDowntime ? (
        <div className="mt-2">
          <p className="text-[22px] font-semibold tracking-tight">Building your baseline</p>
          <p className="text-[13px] text-[var(--color-muted)] mt-1 max-w-lg">
            As your team logs downtime on closed work orders, this becomes the dollars-and-hours
            headline a buyer can see at a glance. Nothing here is estimated for you.
          </p>
        </div>
      ) : (
        <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
          {rateSet ? (
            <>
              <span className="text-[38px] font-semibold tracking-tight text-[var(--color-red)]">{money(d.kpis.downtimeCost!)}</span>
              <span className="text-[15px] text-[var(--color-muted)]">{d.kpis.downtimeHours} h of downtime</span>
            </>
          ) : (
            <span className="text-[38px] font-semibold tracking-tight">
              {d.kpis.downtimeHours} <span className="text-[18px] font-normal text-[var(--color-muted)]">h of downtime</span>
            </span>
          )}
          {delta != null && (
            <span className="text-[13px] font-medium" style={{ color: deltaColor }}>
              {delta < 0 ? "↓" : delta > 0 ? "↑" : ""} {Math.abs(delta)}% vs prior period
            </span>
          )}
        </div>
      )}
      {!rateSet && d.hasDowntime && (
        <p className="text-[12px] text-[var(--color-faint)] mt-2">
          Set your line&apos;s downtime rate on the{" "}
          <Link href="/dashboard" className="text-[var(--color-accent)] hover:underline">Dashboard</Link>{" "}
          to see this in dollars.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label, value, unit, sub, tone,
}: {
  label: string; value: number; unit: string; sub: string; tone: "good" | "warn" | "muted";
}) {
  const color = tone === "good" ? "var(--color-green)" : tone === "warn" ? "var(--color-amber)" : "var(--color-text)";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className="text-[30px] font-bold" style={{ color: value > 0 ? color : "var(--color-faint)" }}>{value}</span>
        <span className="text-[12px] text-[var(--color-muted)]">{unit}</span>
      </div>
      <p className="text-[11.5px] text-[var(--color-muted)] mt-1.5 leading-snug">{sub}</p>
    </div>
  );
}

function MiniKpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] font-medium">{label}</p>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-[22px] font-semibold">{value}</span>
        {unit && <span className="text-[11px] text-[var(--color-muted)]">{unit}</span>}
      </div>
      <p className="text-[11px] text-[var(--color-faint)] mt-0.5">{sub}</p>
    </div>
  );
}
