"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface ReusedFix {
  sourceId: string;
  label: string;
  assetName: string | null;
  timesSurfaced: number;
  timesUsed: number;
  originalAuthor: string | null;
  avoidedDowntimeHours: number | null;
}
interface Impact {
  periodDays: number;
  repeatsCaughtAtIntake: number;
  workOrdersAssisted: number;
  mostReusedFixes: ReusedFix[];
  comparableWorkOrders: number;
  avoidedDowntimeHours: number | null;
  avoidedDowntimeCost: number | null;
  downtimeCostPerHour: number | null;
  pmsFromRepeats: number;
  hasData: boolean;
  hasEnoughForSavings: boolean;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const periodLabel = (d: number) => (d <= 30 ? "last 30 days" : d <= 90 ? "last 90 days" : d <= 180 ? "last 6 months" : "last year");

export default function ImpactPage() {
  const [d, setD] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [period, setPeriod] = useState(90);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/impact?days=${period}`)
      .then((r) => { if (r.status === 401 || r.status === 403) { setForbidden(true); return null; } return r.json(); })
      .then((j) => j && setD(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <>
      <TopBar
        title="Knowledge Reuse Impact"
        subtitle="When shared fixes get reused — and the downtime they help avoid, proven from your own records"
        right={
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="text-[12px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
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
              <p className="text-[15px] font-medium">Reuse Impact is for managers &amp; admins</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-sm mx-auto">Available to your organization&apos;s managers, admins, and owner.</p>
              <Link href="/today" className="inline-block mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 hover:brightness-110">Back to Today</Link>
            </div>
          ) : !d ? (
            <p className="text-[var(--color-muted)] text-sm">Couldn&apos;t load reuse impact.</p>
          ) : !d.hasData ? (
            <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
              <div className="text-3xl mb-3">🔁</div>
              <p className="text-[15px] font-medium">No reuse impact yet</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">
                Capture root causes and close work orders to build machine memory. Once a fault
                recurs, the prior fix is surfaced at intake and its impact shows up here — nothing is
                estimated until the evidence exists.
              </p>
            </div>
          ) : (
            <>
              {/* Impact hero — honest about whether savings can be shown yet */}
              <div className="rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-surface-2)]/40 p-5 mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Downtime avoided through reuse · {periodLabel(d.periodDays)}
                </p>
                {d.avoidedDowntimeHours == null ? (
                  <div className="mt-2">
                    <p className="text-[20px] font-semibold tracking-tight">Not enough history yet to calculate avoided downtime</p>
                    <p className="text-[13px] text-[var(--color-muted)] mt-1 max-w-lg">
                      A machine needs a few prior same-fault repairs before EAS can honestly compare and
                      credit time saved. Reuse is already being tracked below.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
                    {d.avoidedDowntimeCost != null ? (
                      <>
                        <span className="text-[36px] font-semibold tracking-tight text-[var(--color-green)]">{money(d.avoidedDowntimeCost)}</span>
                        <span className="text-[15px] text-[var(--color-muted)]">{d.avoidedDowntimeHours} h of downtime avoided</span>
                      </>
                    ) : (
                      <span className="text-[36px] font-semibold tracking-tight text-[var(--color-green)]">
                        {d.avoidedDowntimeHours} <span className="text-[17px] font-normal text-[var(--color-muted)]">h of downtime avoided</span>
                      </span>
                    )}
                    <span className="text-[12px] text-[var(--color-faint)]">
                      across {d.comparableWorkOrders} repair{d.comparableWorkOrders === 1 ? "" : "s"} with enough history to compare
                    </span>
                  </div>
                )}
                {d.avoidedDowntimeHours != null && d.downtimeCostPerHour == null && (
                  <p className="text-[12px] text-[var(--color-faint)] mt-2">
                    Set your downtime rate on the <Link href="/dashboard" className="text-[var(--color-accent)] hover:underline">Dashboard</Link> to see this in dollars.
                  </p>
                )}
              </div>

              {/* Reuse counters — impact-first, never entry volume */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-7">
                <Stat label="Prior fixes surfaced at intake" value={d.repeatsCaughtAtIntake} sub="a proven fix shown before work began" />
                <Stat label="Work orders helped by prior knowledge" value={d.workOrdersAssisted} sub="closed with a prior fix in hand" />
                <Stat label="PMs suggested from real failures" value={d.pmsFromRepeats} sub="preventive work born from recurrence" />
              </div>

              {/* Most reused fixes — ranked by proven impact, not entry volume */}
              {d.mostReusedFixes.length > 0 && (
                <section className="mb-7">
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">Most reused fixes &amp; machine memory</h2>
                  <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                    {d.mostReusedFixes.map((f, i) => (
                      <div key={f.sourceId} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
                        <span className="w-8 h-8 rounded-full bg-[var(--color-accent)]/12 text-[var(--color-accent)] grid place-items-center text-[11px] font-semibold shrink-0">
                          {f.timesUsed || f.timesSurfaced}×
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate">
                            <span className="font-mono">{f.label}</span>{f.assetName ? ` · ${f.assetName}` : ""}
                          </p>
                          {/* Impact-based attribution — the Jose line, only when data supports it */}
                          <p className="text-[11.5px] text-[var(--color-muted)]">
                            {f.originalAuthor ? `${f.originalAuthor}'s fix ` : "This fix "}
                            reused on {f.timesUsed} later work order{f.timesUsed === 1 ? "" : "s"}
                            {f.avoidedDowntimeHours != null
                              ? ` — linked to ${f.avoidedDowntimeHours}h fewer downtime`
                              : ""}
                          </p>
                        </div>
                        <Link href={`/work-orders/${f.sourceId}`} className="text-[11px] font-medium text-[var(--color-accent)] shrink-0 hover:underline">View →</Link>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11.5px] text-[var(--color-faint)] mt-2">
                    A fix that keeps getting reused is a documented repair paying off again and again — recognized by the impact it had, not how much was typed.
                  </p>
                </section>
              )}

              <p className="text-[11px] text-[var(--color-faint)] mt-8 text-center">
                Every figure is computed from your organization&apos;s own work orders. Avoided downtime is only
                shown when a machine has enough prior same-fault history to compare honestly.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium">{label}</p>
      <p className="text-[26px] font-bold mt-1" style={{ color: value > 0 ? "var(--color-text)" : "var(--color-faint)" }}>{value}</p>
      <p className="text-[11px] text-[var(--color-faint)] mt-0.5 leading-snug">{sub}</p>
    </div>
  );
}
