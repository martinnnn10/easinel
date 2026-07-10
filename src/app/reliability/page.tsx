// Reliability Command Center — the flagship executive view of the plant's
// machine memory. One screen that answers three questions a plant manager and
// their director actually care about: what has our captured knowledge been
// worth, which machines are still hurting us, and where is the Copilot blind?
//
// Every figure is computed from the org's OWN real records — work orders,
// reuse events, and the knowledge base. Nothing is invented: avoided downtime
// shows only where a machine has enough prior same-fault history to compare
// honestly, and dollars show only when a real downtime rate is configured.
// Premium on screen (the app's industrial dark theme) and print-clean for a
// PDF a manager forwards to leadership — interactive controls drop away on
// print and the surfaces neutralize to white.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getOrg } from "@/lib/auth/session";
import { can, type Role } from "@/lib/auth/roles";
import { getReuseImpact } from "@/lib/reuse/impact";
import { computeRepeatRisks, type RepeatRisk } from "@/lib/reliability/repeatRisks";
import { listGapsByAsset } from "@/lib/knowledge/gaps";
import { PrintButton } from "@/components/PrintButton";
import { SuggestPmButton } from "@/components/SuggestPmButton";
import { SampleDataNote } from "@/components/SampleDataNote";
import { isDemoOrg } from "@/lib/orgs/isDemoOrg";

export const dynamic = "force-dynamic";

const PERIODS = [30, 90, 180] as const;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const hrs = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m} min`);
const periodLabel = (d: number) => (d <= 30 ? "last 30 days" : d <= 90 ? "last 90 days" : "last 6 months");
const ago = (t: number | null) => {
  if (!t) return "—";
  const d = Math.floor((Date.now() - t) / 86400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
};

export default async function ReliabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/reliability");
  if (!can(user.role as Role, "manage_workforce")) redirect("/today");
  const canManagePm = can(user.role as Role, "manage_pm");

  const { days: daysRaw } = await searchParams;
  const days = PERIODS.includes(Number(daysRaw) as (typeof PERIODS)[number]) ? Number(daysRaw) : 30;

  const [org, impact, repeatRisks, gaps] = await Promise.all([
    getOrg(user.orgId),
    getReuseImpact(user.orgId, days),
    computeRepeatRisks(user.orgId, days, 15),
    listGapsByAsset(user.orgId, days),
  ]);

  const generated = new Date();
  const orgName = org?.name ?? "Your plant";
  const isDemo = isDemoOrg({ id: user.orgId, name: org?.name });
  const uncovered = repeatRisks.filter((r) => r.pmState === "none");
  const topGaps = gaps.slice(0, 6);
  const hasAnything = impact.hasData || repeatRisks.length > 0 || gaps.length > 0;

  // Honest coverage: of the work orders prior knowledge assisted, how many had
  // enough same-fault history to actually verify a downtime saving. Never a
  // fabricated gauge — it only ever shows a real ratio.
  const coverage =
    impact.workOrdersAssisted > 0
      ? Math.min(1, impact.comparableWorkOrders / impact.workOrdersAssisted)
      : null;

  return (
    <div className="h-full flex flex-col print:h-auto print:block print:text-neutral-900">
      {/* ── Command bar (hidden on print) ─────────────────────────────────── */}
      <header className="print:hidden shrink-0 h-14 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur flex items-center justify-between px-5 pl-14 md:pl-5 gap-3">
        <div className="min-w-0">
          <h1 className="text-[14px] font-semibold tracking-tight truncate">Reliability Command Center</h1>
          <p className="text-[11px] text-[var(--color-faint)] truncate -mt-0.5">
            What your machine memory is worth · {periodLabel(days)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-0.5 text-[12px]">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/reliability?days=${p}`}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  p === days
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {p === 30 ? "30d" : p === 90 ? "90d" : "6mo"}
              </Link>
            ))}
          </div>
          <div className="hidden sm:block">
            <PrintButton label="Export PDF" />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto print:overflow-visible">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 py-6 print:py-2 print:max-w-none">
          {/* Sample-data disclaimer — demo workspace only; print-visible so the
              leadership PDF also carries the label. */}
          {isDemo && (
            <div className="mb-4 print:mb-3">
              <SampleDataNote />
            </div>
          )}
          {/* Print-only report masthead. */}
          <div className="hidden print:flex items-start justify-between border-b border-neutral-300 pb-3 mb-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-400">EAS Reliability Report</p>
              <h2 className="text-[20px] font-bold mt-0.5">{orgName}</h2>
              <p className="text-[12px] text-neutral-500">Maintenance intelligence · {periodLabel(days)}</p>
            </div>
            <div className="text-right text-[10px] text-neutral-400">
              <p>Generated</p>
              <p>{generated.toISOString().slice(0, 10)}</p>
            </div>
          </div>

          {!hasAnything ? (
            <EmptyState orgName={orgName} />
          ) : (
            <div className="flex flex-col gap-5 print:gap-4">
              {/* ── HERO: proven value ─────────────────────────────────────── */}
              <section className="break-inside-avoid overflow-hidden rounded-2xl border border-[var(--color-border)] print:border-neutral-300 bg-gradient-to-br from-[var(--color-accent-soft)] via-[var(--color-surface)] to-[var(--color-surface)] print:bg-white print:from-white print:via-white print:to-white">
                <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-green)] flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" /> Downtime avoided through knowledge reuse
                    </p>
                    {impact.avoidedDowntimeHours == null ? (
                      <>
                        <p className="text-[26px] sm:text-[30px] font-bold leading-tight mt-1.5">
                          Building the baseline
                        </p>
                        <p className="text-[13px] text-[var(--color-muted)] print:text-neutral-600 mt-1 max-w-lg">
                          Reuse is being tracked, but no machine has enough prior same-fault history yet to
                          credit avoided downtime honestly. The activity below is real; the dollar proof fills
                          in as faults recur and prior fixes get reused.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-end gap-2 mt-1.5 flex-wrap">
                          <span className="text-[44px] sm:text-[54px] font-bold leading-none text-[var(--color-green)]">
                            {impact.avoidedDowntimeCost != null ? money(impact.avoidedDowntimeCost) : impact.avoidedDowntimeHours}
                          </span>
                          <span className="text-[16px] text-[var(--color-muted)] print:text-neutral-600 pb-1">
                            {impact.avoidedDowntimeCost != null
                              ? `· ${impact.avoidedDowntimeHours} h of downtime avoided`
                              : "h of downtime avoided"}
                          </span>
                        </div>
                        <p className="text-[13px] text-[var(--color-muted)] print:text-neutral-600 mt-2 max-w-lg">
                          Verified across{" "}
                          <strong className="text-[var(--color-text)] print:text-neutral-900 font-semibold">
                            {impact.comparableWorkOrders}
                          </strong>{" "}
                          repair{impact.comparableWorkOrders === 1 ? "" : "s"} where the machine had enough prior
                          same-fault history to compare — measured against each machine&apos;s own median, never an
                          industry guess.
                        </p>
                        {impact.downtimeCostPerHour == null && (
                          <p className="text-[12px] text-[var(--color-faint)] print:text-neutral-400 mt-2">
                            <Link href="/dashboard" className="underline print:no-underline hover:text-[var(--color-text)]">
                              Set a downtime cost rate
                            </Link>{" "}
                            to show this in dollars.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {coverage != null && impact.avoidedDowntimeHours != null && (
                    <div className="shrink-0 flex sm:flex-col items-center gap-3 sm:gap-1.5">
                      <Donut fraction={coverage} />
                      <p className="text-[11px] text-[var(--color-faint)] print:text-neutral-500 text-center max-w-[9rem] leading-snug">
                        of assisted repairs had enough history to verify
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* ── KRI strip ──────────────────────────────────────────────── */}
              <section className="break-inside-avoid">
                <SectionHeader label="Knowledge reuse activity" hint="How often captured memory showed up in the work" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatTile label="Prior fixes surfaced at intake" value={impact.repeatsCaughtAtIntake} accent="green" />
                  <StatTile label="Work orders helped by prior knowledge" value={impact.workOrdersAssisted} accent="green" />
                  <StatTile label="Times Copilot cited your own knowledge" value={impact.knowledgeCitations} accent="info" />
                  <StatTile label="PMs born from real failures" value={impact.pmsFromRepeats} accent="accent" />
                </div>
              </section>

              {/* ── Chronic repeat-risk machines ───────────────────────────── */}
              <section className="break-inside-avoid">
                <SectionHeader
                  label="Chronic repeat-risk machines"
                  hint={
                    uncovered.length > 0
                      ? `${uncovered.length} recurring ${uncovered.length === 1 ? "fault has" : "faults have"} no PM in place`
                      : "Faults recurring at or above the alert threshold"
                  }
                  badge={uncovered.length > 0 ? { text: `${uncovered.length} to act on`, tone: "amber" } : undefined}
                />
                {repeatRisks.length === 0 ? (
                  <Card>
                    <p className="text-[13px] text-[var(--color-muted)] print:text-neutral-600 px-4 py-4">
                      No fault has recurred often enough this period to flag as chronic. That&apos;s a good sign — keep
                      capturing root causes so the pattern stays visible.
                    </p>
                  </Card>
                ) : (
                  <Card>
                    {repeatRisks.map((r, i) => (
                      <RepeatRow key={`${r.assetId}:${r.label}`} r={r} first={i === 0} canManagePm={canManagePm} />
                    ))}
                  </Card>
                )}
              </section>

              {/* ── Sharpen the Copilot (knowledge gaps) ───────────────────── */}
              {topGaps.length > 0 && (
                <section className="break-inside-avoid">
                  <SectionHeader
                    label="Sharpen the Copilot"
                    hint="Machines your team asked about with none of your own documents to answer from"
                    badge={{ text: `${gaps.length} blind ${gaps.length === 1 ? "spot" : "spots"}`, tone: "info" }}
                  />
                  <Card>
                    {topGaps.map((g, i) => (
                      <Link
                        key={g.assetId}
                        href={`/assets/${g.assetId}?upload=1`}
                        className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--color-surface-2)]/60 print:hover:bg-transparent ${
                          i > 0 ? "border-t border-[var(--color-border-soft)] print:border-neutral-200" : ""
                        }`}
                      >
                        <span className="w-8 h-8 rounded-full bg-[var(--color-info-soft)] print:bg-neutral-100 text-[var(--color-info)] grid place-items-center text-[11px] font-semibold shrink-0">
                          {g.count}×
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium truncate">{g.assetName}</span>
                          <span className="block text-[11.5px] text-[var(--color-faint)] print:text-neutral-500 truncate">
                            Last asked: “{g.lastQuestion}”
                          </span>
                        </span>
                        <span className="text-[11px] font-medium text-[var(--color-info)] shrink-0 print:hidden">Upload a doc →</span>
                      </Link>
                    ))}
                  </Card>
                </section>
              )}

              {/* ── Machine memory: most-reused fixes ──────────────────────── */}
              {impact.mostReusedFixes.length > 0 && (
                <section className="break-inside-avoid">
                  <SectionHeader label="Machine memory that paid off" hint="The captured fixes your team reused the most" />
                  <Card>
                    {impact.mostReusedFixes.map((f, i) => (
                      <div
                        key={f.sourceId}
                        className={`flex items-center gap-3 px-4 py-2.5 ${
                          i > 0 ? "border-t border-[var(--color-border-soft)] print:border-neutral-200" : ""
                        }`}
                      >
                        <span className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] print:bg-neutral-100 text-[var(--color-muted)] print:text-neutral-700 grid place-items-center text-[11px] font-semibold shrink-0">
                          {f.timesUsed || f.timesSurfaced}×
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] font-medium truncate">
                            <span className="font-mono">{f.label}</span>
                            {f.assetName ? <span className="text-[var(--color-faint)] print:text-neutral-500"> · {f.assetName}</span> : ""}
                          </p>
                          <p className="text-[11px] text-[var(--color-faint)] print:text-neutral-500">
                            {f.originalAuthor ? `${f.originalAuthor}'s fix ` : "This fix "}
                            reused on {f.timesUsed} later work order{f.timesUsed === 1 ? "" : "s"}
                            {f.avoidedDowntimeHours != null ? ` — ${f.avoidedDowntimeHours}h fewer downtime` : ""}
                          </p>
                        </div>
                        {f.avoidedDowntimeHours != null && (
                          <span className="shrink-0 text-[11px] font-semibold text-[var(--color-green)] rounded-full bg-[var(--color-accent-soft)] print:bg-transparent px-2 py-0.5">
                            −{f.avoidedDowntimeHours}h
                          </span>
                        )}
                      </div>
                    ))}
                  </Card>
                </section>
              )}

              {/* ── Copilot-cited knowledge (credit the authors) ───────────── */}
              {impact.citedKnowledge.length > 0 && (
                <section className="break-inside-avoid">
                  <SectionHeader label="Knowledge the Copilot is citing" hint="Your team's own lessons and documents, answering questions" />
                  <Card>
                    {impact.citedKnowledge.map((c, i) => {
                      const inner = (
                        <>
                          <span className="w-8 h-8 rounded-full bg-[var(--color-info-soft)] print:bg-neutral-100 text-[var(--color-info)] grid place-items-center text-[11px] font-semibold shrink-0">
                            {c.timesCited}×
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12.5px] font-medium truncate">
                              {c.label}
                              {c.assetName ? <span className="text-[var(--color-faint)] print:text-neutral-500"> · {c.assetName}</span> : ""}
                            </p>
                            <p className="text-[11px] text-[var(--color-faint)] print:text-neutral-500">
                              {c.kind === "lesson"
                                ? `${c.author ? `${c.author}'s` : "A teammate's"} lesson`
                                : "Uploaded document"}{" "}
                              cited in {c.timesCited} answer{c.timesCited === 1 ? "" : "s"}
                            </p>
                          </div>
                        </>
                      );
                      const cls = `flex items-center gap-3 px-4 py-2.5 ${
                        i > 0 ? "border-t border-[var(--color-border-soft)] print:border-neutral-200" : ""
                      }`;
                      return c.workOrderId ? (
                        <Link key={`${c.kind}:${c.sourceId}`} href={`/work-orders/${c.workOrderId}`} className={`${cls} transition hover:bg-[var(--color-surface-2)]/60 print:hover:bg-transparent`}>
                          {inner}
                        </Link>
                      ) : (
                        <div key={`${c.kind}:${c.sourceId}`} className={cls}>{inner}</div>
                      );
                    })}
                  </Card>
                </section>
              )}
            </div>
          )}

          <p className="text-[10.5px] text-[var(--color-faint)] print:text-neutral-400 mt-7 border-t border-[var(--color-border)] print:border-neutral-200 pt-3 leading-relaxed">
            Every figure is computed from {orgName}&apos;s own work orders and knowledge base. Avoided downtime is
            shown only where a machine has enough prior same-fault history to compare honestly; dollar figures appear
            only when a downtime cost rate is configured. Nothing is estimated from other plants. Generated by EAS
            Maintenance Intelligence{" "}
            <span className="print:inline hidden">on {generated.toISOString().slice(0, 10)}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Repeat-risk row: fault, recurrence, downtime, PM status, one-tap fix ─────
function RepeatRow({ r, first, canManagePm }: { r: RepeatRisk; first: boolean; canManagePm: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${first ? "" : "border-t border-[var(--color-border-soft)] print:border-neutral-200"}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate">
          {r.assetName}
          <span className="text-[var(--color-faint)] print:text-neutral-500 font-normal"> · </span>
          <span className="font-mono text-[12px] text-[var(--color-muted)] print:text-neutral-600">{r.label}</span>
        </p>
        <p className="text-[11px] text-[var(--color-faint)] print:text-neutral-500">
          {r.count}× this period
          {r.totalDowntimeMins > 0 ? ` · ${hrs(r.totalDowntimeMins)} down` : ""}
          {r.lastAt ? ` · last ${ago(r.lastAt)}` : ""}
        </p>
      </div>
      {r.pmState === "none" ? (
        <div className="shrink-0 flex items-center gap-2">
          <PmPill state="none" />
          <span className="print:hidden">
            <SuggestPmButton workOrderId={r.sourceWorkOrderId} canManagePm={canManagePm} size="sm" />
          </span>
        </div>
      ) : (
        <PmPill state={r.pmState} />
      )}
    </div>
  );
}

function PmPill({ state }: { state: RepeatRisk["pmState"] }) {
  const map = {
    active: { text: "PM in place", cls: "text-[var(--color-green)] bg-[var(--color-accent-soft)] print:bg-transparent" },
    draft: { text: "PM drafted", cls: "text-[var(--color-muted)] bg-[var(--color-surface-2)] print:bg-transparent print:text-neutral-500" },
    none: { text: "No PM", cls: "text-[var(--color-amber)] bg-[color-mix(in_srgb,var(--color-amber)_14%,transparent)] print:bg-transparent" },
  }[state];
  return <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 ${map.cls}`}>{map.text}</span>;
}

// ── Honest coverage donut (pure CSS/SVG, no library) ────────────────────────
function Donut({ fraction }: { fraction: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, fraction)) * c;
  return (
    <svg viewBox="0 0 64 64" className="w-[68px] h-[68px]" role="img" aria-label={`${Math.round(fraction * 100)}% verified`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
      <circle
        cx="32" cy="32" r={r} fill="none" stroke="var(--color-green)" strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`} transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="fill-[var(--color-text)] print:fill-neutral-900" style={{ fontSize: 15, fontWeight: 700 }}>
        {Math.round(fraction * 100)}%
      </text>
    </svg>
  );
}

// ── Layout primitives (centralize the light/print dual styling) ─────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] print:border-neutral-300 bg-[var(--color-surface)] print:bg-white overflow-hidden">
      {children}
    </div>
  );
}

function SectionHeader({
  label,
  hint,
  badge,
}: {
  label: string;
  hint?: string;
  badge?: { text: string; tone: "amber" | "info" };
}) {
  const badgeCls =
    badge?.tone === "amber"
      ? "text-[var(--color-amber)] bg-[color-mix(in_srgb,var(--color-amber)_14%,transparent)]"
      : "text-[var(--color-info)] bg-[var(--color-info-soft)]";
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2 px-0.5">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-tight">{label}</h3>
        {hint && <p className="text-[11px] text-[var(--color-faint)] print:text-neutral-500 truncate">{hint}</p>}
      </div>
      {badge && (
        <span className={`shrink-0 text-[10.5px] font-semibold rounded-full px-2 py-0.5 print:bg-transparent print:border print:border-neutral-300 ${badgeCls}`}>
          {badge.text}
        </span>
      )}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent: "green" | "info" | "accent" }) {
  const on = value > 0;
  const color = !on
    ? "text-[var(--color-faint)] print:text-neutral-400"
    : accent === "info"
      ? "text-[var(--color-info)]"
      : "text-[var(--color-text)] print:text-neutral-900";
  return (
    <div className="rounded-xl border border-[var(--color-border)] print:border-neutral-300 bg-[var(--color-surface)] print:bg-white p-3.5">
      <p className={`text-[26px] font-bold leading-none ${color}`}>{value}</p>
      <p className="text-[11px] text-[var(--color-muted)] print:text-neutral-500 mt-1.5 leading-snug">{label}</p>
    </div>
  );
}

function EmptyState({ orgName }: { orgName: string }) {
  return (
    <div className="text-center py-16 border border-dashed border-[var(--color-border)] print:border-neutral-300 rounded-2xl">
      <div className="text-3xl mb-3">📊</div>
      <p className="text-[15px] font-medium">Not enough history yet for this period</p>
      <p className="text-[var(--color-muted)] print:text-neutral-500 text-[13px] mt-1.5 max-w-md mx-auto leading-relaxed">
        Capture root causes and close work orders to build {orgName}&apos;s machine memory. Once faults recur and prior
        fixes get reused, this command center fills in — nothing is estimated until the evidence exists.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 print:hidden">
        <Link href="/work-orders" className="rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[13px] font-medium px-4 py-2 hover:brightness-110">
          Log a work order
        </Link>
        <Link href="/knowledge" className="rounded-lg border border-[var(--color-border)] text-[13px] font-medium px-4 py-2 hover:bg-[var(--color-surface-2)]">
          Upload a manual
        </Link>
      </div>
    </div>
  );
}

function ShieldCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
