// Manager Reliability Report — a print/PDF one-pager a plant manager forwards to
// their director. Consolidates the org's OWN real records: downtime avoided
// through knowledge reuse, reuse activity, chronic repeat-risk machines, and the
// most-reused fixes. Server-rendered so it prints clean (app chrome is hidden on
// print). Nothing invented — honest empty states throughout; dollars only when a
// real downtime rate is configured.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getOrg } from "@/lib/auth/session";
import { can, type Role } from "@/lib/auth/roles";
import { getReuseImpact } from "@/lib/reuse/impact";
import { computeRepeatRisks } from "@/lib/reliability/repeatRisks";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const PERIODS = [30, 90, 180] as const;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const hrs = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m} min`);
const periodLabel = (d: number) => (d <= 30 ? "last 30 days" : d <= 90 ? "last 90 days" : "last 6 months");

export default async function ReliabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/reliability");
  if (!can(user.role as Role, "manage_workforce")) redirect("/today");

  const { days: daysRaw } = await searchParams;
  const days = PERIODS.includes(Number(daysRaw) as (typeof PERIODS)[number]) ? Number(daysRaw) : 30;

  const [org, impact, repeatRisks] = await Promise.all([
    getOrg(user.orgId),
    getReuseImpact(user.orgId, days),
    computeRepeatRisks(user.orgId, days, 15),
  ]);

  const generated = new Date();
  const uncovered = repeatRisks.filter((r) => r.pmState === "none").length;
  const hasAnything = impact.hasData || repeatRisks.length > 0;

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Toolbar — hidden when printing */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center gap-3">
          <Link href="/today" className="text-neutral-500 text-[22px] leading-none -ml-1 px-1" aria-label="Back">←</Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-tight">Reliability Report</h1>
            <p className="text-[11px] text-neutral-500 leading-tight">Print or save as PDF to share with leadership.</p>
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/reliability?days=${p}`}
                className={`rounded-md px-2 py-1 ${p === days ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-100"}`}
              >
                {p === 30 ? "30d" : p === 90 ? "90d" : "6mo"}
              </Link>
            ))}
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Report header */}
        <div className="flex items-start justify-between border-b border-neutral-200 pb-4 mb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">EAS Reliability Report</p>
            <h2 className="text-[22px] font-bold mt-0.5">{org?.name ?? "Your plant"}</h2>
            <p className="text-[13px] text-neutral-500">Maintenance intelligence · {periodLabel(days)}</p>
          </div>
          <div className="text-right text-[11px] text-neutral-400">
            <p>Generated</p>
            <p>{generated.toISOString().slice(0, 10)}</p>
          </div>
        </div>

        {!hasAnything ? (
          <div className="text-center py-16 border border-dashed border-neutral-300 rounded-2xl">
            <div className="text-3xl mb-3">📊</div>
            <p className="text-[15px] font-medium">Not enough history yet for this period</p>
            <p className="text-neutral-500 text-sm mt-1 max-w-md mx-auto">
              Capture root causes and close work orders to build machine memory. Once faults recur and prior
              fixes get reused, this report fills in — nothing is estimated until the evidence exists.
            </p>
          </div>
        ) : (
          <>
            {/* Impact headline */}
            <section className="mb-7">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Downtime avoided through knowledge reuse</h3>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5">
                {impact.avoidedDowntimeHours == null ? (
                  <p className="text-[15px] text-neutral-600">
                    Not enough same-fault history yet to credit avoided downtime honestly. Reuse activity is tracked below.
                  </p>
                ) : (
                  <div className="flex items-baseline gap-3 flex-wrap">
                    {impact.avoidedDowntimeCost != null ? (
                      <>
                        <span className="text-[34px] font-bold text-emerald-700 leading-none">{money(impact.avoidedDowntimeCost)}</span>
                        <span className="text-[15px] text-neutral-600">· {impact.avoidedDowntimeHours} h of downtime avoided</span>
                      </>
                    ) : (
                      <span className="text-[34px] font-bold text-emerald-700 leading-none">
                        {impact.avoidedDowntimeHours} <span className="text-[16px] font-normal text-neutral-600">h of downtime avoided</span>
                      </span>
                    )}
                    <span className="text-[12px] text-neutral-400">
                      across {impact.comparableWorkOrders} repair{impact.comparableWorkOrders === 1 ? "" : "s"} with enough history to compare
                    </span>
                  </div>
                )}
                {impact.avoidedDowntimeHours != null && impact.downtimeCostPerHour == null && (
                  <p className="text-[12px] text-neutral-400 mt-2">Set a downtime cost rate on the Dashboard to show this in dollars.</p>
                )}
              </div>
            </section>

            {/* Reuse activity */}
            <section className="mb-7">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Knowledge reuse activity</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Prior fixes surfaced at intake" value={impact.repeatsCaughtAtIntake} />
                <Stat label="Work orders helped by prior knowledge" value={impact.workOrdersAssisted} />
                <Stat label="Knowledge cited by Copilot" value={impact.knowledgeCitations} />
                <Stat label="PMs born from real failures" value={impact.pmsFromRepeats} />
              </div>
            </section>

            {/* Repeat-risk machines */}
            <section className="mb-7 break-inside-avoid">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">
                Chronic repeat-risk machines {uncovered > 0 ? `· ${uncovered} with no PM in place` : ""}
              </h3>
              {repeatRisks.length === 0 ? (
                <p className="text-[13px] text-neutral-500">No fault has recurred enough this period to flag. Good sign.</p>
              ) : (
                <div className="rounded-xl border border-neutral-200 overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-neutral-50 text-neutral-500 text-[11px] uppercase tracking-wide">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">Machine</th>
                        <th className="text-left font-medium px-3 py-2">Fault</th>
                        <th className="text-right font-medium px-3 py-2">Times</th>
                        <th className="text-right font-medium px-3 py-2">Downtime</th>
                        <th className="text-right font-medium px-3 py-2">PM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repeatRisks.map((r, i) => (
                        <tr key={`${r.assetId}:${r.label}`} className={i > 0 ? "border-t border-neutral-100" : ""}>
                          <td className="px-3 py-2 font-medium">{r.assetName}</td>
                          <td className="px-3 py-2 text-neutral-600">{r.label}</td>
                          <td className="px-3 py-2 text-right">{r.count}×</td>
                          <td className="px-3 py-2 text-right text-neutral-600">{r.totalDowntimeMins ? hrs(r.totalDowntimeMins) : "—"}</td>
                          <td className={`px-3 py-2 text-right font-medium ${r.pmState === "active" ? "text-emerald-700" : r.pmState === "draft" ? "text-neutral-500" : "text-amber-700"}`}>
                            {r.pmState === "active" ? "In place" : r.pmState === "draft" ? "Drafted" : "None"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Most reused fixes */}
            {impact.mostReusedFixes.length > 0 && (
              <section className="mb-7 break-inside-avoid">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-neutral-500 mb-2">Most reused fixes &amp; machine memory</h3>
                <div className="rounded-xl border border-neutral-200 overflow-hidden">
                  {impact.mostReusedFixes.map((f, i) => (
                    <div key={f.sourceId} className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? "border-t border-neutral-100" : ""}`}>
                      <span className="w-7 h-7 rounded-full bg-neutral-100 text-neutral-700 grid place-items-center text-[11px] font-semibold shrink-0">
                        {f.timesUsed || f.timesSurfaced}×
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium truncate">
                          <span className="font-mono">{f.label}</span>{f.assetName ? ` · ${f.assetName}` : ""}
                        </p>
                        <p className="text-[11px] text-neutral-500">
                          {f.originalAuthor ? `${f.originalAuthor}'s fix ` : "This fix "}
                          reused on {f.timesUsed} later work order{f.timesUsed === 1 ? "" : "s"}
                          {f.avoidedDowntimeHours != null ? ` — ${f.avoidedDowntimeHours}h fewer downtime` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <p className="text-[10.5px] text-neutral-400 mt-8 border-t border-neutral-200 pt-3">
          Every figure is computed from {org?.name ?? "your organization"}&apos;s own work orders and knowledge base.
          Avoided downtime is shown only where a machine has enough prior same-fault history to compare honestly;
          dollar figures appear only when a downtime cost rate is configured. Generated by EAS Maintenance Intelligence.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <p className="text-[22px] font-bold leading-none" style={{ color: value > 0 ? "#111" : "#bbb" }}>{value}</p>
      <p className="text-[10.5px] text-neutral-500 mt-1 leading-snug">{label}</p>
    </div>
  );
}
