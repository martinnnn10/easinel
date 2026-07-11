"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { ActivationChecklist } from "@/components/ActivationChecklist";

interface AssetCtx {
  assetId: string;
  assetName: string;
  line: string | null;
  area: string | null;
  assetClass: string;
  criticality: string;
}
type RcaState = "needed" | "draft" | "technician_completed" | "manager_confirmed" | null;
interface OpenWork {
  id: string; number: string | null; title: string; symptom: string | null;
  priority: string; status: string; type: string; openMins: number;
  failureType: string; rcaStatus: RcaState; asset: AssetCtx | null;
}
interface MachineDown {
  assetId: string; name: string; line: string | null; assetClass: string; criticality: string;
  wo: { id: string; number: string | null; title: string; symptom: string | null; openMins: number; failureType: string } | null;
}
interface Today {
  machinesDown: MachineDown[];
  pmsDue: { id: string; title: string; assetId: string | null }[];
  stats: { open: number; inProgress: number; closedThisShift: number; pmsDue: number };
  openCritical: OpenWork[];
  recentClosed: { id: string; number: string | null; title: string; closedAt: number | null; assetName: string | null; rcaStatus: RcaState }[];
  handoverNotes: { id: string; note: string; category: string; priority: string; assetName?: string | null }[];
  recentSessions: { id: string; title: string; updatedAt: number; assetName: string | null; failureType: string }[];
}

const priDot: Record<string, string> = { urgent: "var(--color-red)", high: "var(--color-amber)", medium: "var(--color-muted)", low: "var(--color-faint)" };

function dur(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function TodayPage() {
  const [d, setD] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    fetch("/api/today").then((r) => r.json()).then(setD).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar
        title="Today"
        subtitle="What's down, what needs attention, and what to do next — grounded in your plant data"
        right={
          <div className="flex items-center gap-2">
            <Link href="/field" className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-3.5 py-1.5 hover:brightness-110 flex items-center gap-1.5" title="Fast capture at the machine">
              <span aria-hidden>📱</span> At the machine
            </Link>
            <Link href="/copilot" className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]">Ask Copilot</Link>
            <Link href="/work-orders" className="hidden sm:inline-block text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]">Create work order</Link>
            <Link href="/handover" className="hidden sm:inline-block text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]">Add handover note</Link>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-6">
          {loading ? (
            <div className="h-40 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
          ) : !d ? (
            <p className="text-[var(--color-muted)] text-sm">Couldn&apos;t load today&apos;s board.</p>
          ) : (
            <>
              <ActivationChecklist onLaunchWizard={() => setWizard(true)} reloadKey={reloadKey} />

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] mb-7 text-[var(--color-muted)]">
                <span><strong className={d.machinesDown.length > 0 ? "text-[var(--color-red)]" : "text-[var(--color-text)]"}>{d.machinesDown.length}</strong> down</span>
                <span><strong className="text-[var(--color-text)]">{d.stats.open}</strong> open</span>
                <span><strong className="text-[var(--color-text)]">{d.stats.inProgress}</strong> in progress</span>
                <span><strong className={d.stats.pmsDue > 0 ? "text-[var(--color-amber)]" : "text-[var(--color-text)]"}>{d.stats.pmsDue}</strong> PMs due</span>
                <span><strong className="text-[var(--color-text)]">{d.stats.closedThisShift}</strong> closed today</span>
              </div>

              {/* Command board — machines down + open critical get rich cards */}
              <div className="grid lg:grid-cols-2 gap-x-6 gap-y-7">
                <Section title="Machines down" href="/assets" empty="Nothing down right now.">
                  {d.machinesDown.map((m) => <MachineDownCard key={m.assetId} m={m} />)}
                </Section>

                <Section title="Open critical work" href="/work-orders" empty="No open work.">
                  {d.openCritical.map((w) => <OpenWorkCard key={w.id} w={w} />)}
                </Section>
              </div>

              {/* Secondary sections — compact rows */}
              <div className="grid md:grid-cols-2 gap-x-8 gap-y-7 mt-7">
                <Section title="PMs due" href="/pm" empty="No PMs due.">
                  {d.pmsDue.map((p) => <Row key={p.id} href={`/pm/${p.id}`} dot="var(--color-amber)" text={p.title} />)}
                </Section>

                <Section title="Shift handover" href="/handover" empty="No handover notes in the last 24h.">
                  {d.handoverNotes.map((n) => <Row key={n.id} dot={priDot[n.priority] ?? "var(--color-muted)"} text={n.note} sub={n.assetName ?? undefined} />)}
                </Section>

                <Section title="Recent Copilot sessions" href="/sessions" empty="No recent sessions.">
                  {d.recentSessions.map((s) => (
                    <Link key={s.id} href={`/copilot?c=${s.id}`} className="block rounded-md hover:bg-[var(--color-surface-2)] px-1.5 -mx-1.5 py-1.5 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
                        <span className="text-[13px] truncate flex-1">{s.title}</span>
                        <span className="text-[11px] text-[var(--color-faint)] shrink-0">{new Date(s.updatedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 ml-4">
                        {s.assetName ? (
                          <Badge tone="info">{s.assetName}</Badge>
                        ) : (
                          <Badge tone="muted">Unlinked session</Badge>
                        )}
                        {s.failureType !== "Unknown" && <Badge tone="muted">{s.failureType}</Badge>}
                      </div>
                    </Link>
                  ))}
                </Section>

                <Section title="Recently closed" href="/work-orders" empty="Nothing closed recently.">
                  {d.recentClosed.map((w) => (
                    <Link key={w.id} href={`/work-orders/${w.id}`} className="block rounded-md hover:bg-[var(--color-surface-2)] px-1.5 -mx-1.5 py-1.5 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-green)" }} />
                        <span className="text-[13px] truncate flex-1">{w.title}</span>
                        {w.rcaStatus && <RcaBadge s={w.rcaStatus} />}
                        <span className="text-[11px] text-[var(--color-faint)] shrink-0">{w.number ?? ""}</span>
                      </div>
                    </Link>
                  ))}
                </Section>
              </div>
            </>
          )}
        </div>
      </div>

      {wizard && <OnboardingWizard onClose={() => { setWizard(false); setReloadKey((k) => k + 1); fetch("/api/today").then((r) => r.json()).then(setD).catch(() => {}); }} />}
    </>
  );
}

// ── Command-board cards ─────────────────────────────────────────────────────
function OpenWorkCard({ w }: { w: OpenWork }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priDot[w.priority] ?? "var(--color-muted)" }} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug">{w.title}</p>
          {w.asset ? (
            <p className="text-[11.5px] text-[var(--color-muted)] mt-0.5">
              {w.asset.assetName}{w.asset.line ? ` · ${w.asset.line}` : ""}
            </p>
          ) : (
            <p className="text-[11.5px] text-[var(--color-amber)] mt-0.5">No asset linked — link equipment to build machine memory.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-4">
        {w.asset && <CritBadge c={w.asset.criticality} />}
        {w.asset && <Badge tone="muted">{w.asset.assetClass}</Badge>}
        {w.failureType !== "Unknown" && <Badge tone="info">{w.failureType}</Badge>}
        {w.rcaStatus && <RcaBadge s={w.rcaStatus} />}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2 ml-4">
        <span className="text-[11px] text-[var(--color-faint)]">
          Open {dur(w.openMins)}{w.number ? ` · ${w.number}` : ""} · {w.status.replace("_", " ")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-4">
        <Action href={`/work-orders/${w.id}?ask=1`}>Ask Copilot</Action>
        <Action href={`/work-orders/${w.id}`}>Open WO</Action>
        {w.asset ? (
          <Action href={`/work-orders/${w.id}`} primary>{w.rcaStatus && w.rcaStatus !== "needed" ? "View RCA" : "Start RCA"}</Action>
        ) : (
          <Action href={`/work-orders/${w.id}`} primary>Link asset</Action>
        )}
      </div>
    </div>
  );
}

function MachineDownCard({ m }: { m: MachineDown }) {
  return (
    <div className="rounded-xl border border-[var(--color-red)]/25 bg-[color-mix(in_srgb,var(--color-red)_5%,var(--color-surface))] p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-red)" }} />
        <div className="min-w-0 flex-1">
          <Link href={`/assets/${m.assetId}`} className="text-[13px] font-medium leading-snug hover:underline">{m.name}</Link>
          {m.wo?.symptom || m.wo?.title ? (
            <p className="text-[11.5px] text-[var(--color-muted)] mt-0.5 truncate">{m.wo.symptom || m.wo.title}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-4">
        <CritBadge c={m.criticality} />
        <Badge tone="muted">{m.assetClass}</Badge>
        {m.line && <Badge tone="muted">{m.line}</Badge>}
        {m.wo && m.wo.failureType !== "Unknown" && <Badge tone="info">{m.wo.failureType}</Badge>}
      </div>
      <div className="flex items-center gap-2 mt-2 ml-4">
        {m.wo && <span className="text-[11px] text-[var(--color-faint)]">Down {dur(m.wo.openMins)}{m.wo.number ? ` · ${m.wo.number}` : ""}</span>}
        <div className="flex items-center gap-1.5 ml-auto">
          {m.wo ? <Action href={`/work-orders/${m.wo.id}?ask=1`}>Ask Copilot</Action> : <Action href={`/assets/${m.assetId}`}>Ask Copilot</Action>}
          {m.wo ? <Action href={`/work-orders/${m.wo.id}`} primary>Open WO</Action> : <Action href={`/work-orders`} primary>Open WO</Action>}
        </div>
      </div>
    </div>
  );
}

// ── Badges + actions ────────────────────────────────────────────────────────
function Badge({ children, tone }: { children: React.ReactNode; tone: "muted" | "info" | "amber" | "red" | "green" }) {
  const cls = {
    muted: "text-[var(--color-muted)] bg-[var(--color-surface-2)]",
    info: "text-[var(--color-info)] bg-[var(--color-info-soft)]",
    amber: "text-[var(--color-amber)] bg-[color-mix(in_srgb,var(--color-amber)_14%,transparent)]",
    red: "text-[var(--color-red)] bg-[color-mix(in_srgb,var(--color-red)_14%,transparent)]",
    green: "text-[var(--color-green)] bg-[var(--color-accent-soft)]",
  }[tone];
  return <span className={`text-[10.5px] font-medium rounded px-1.5 py-0.5 ${cls}`}>{children}</span>;
}

function CritBadge({ c }: { c: string }) {
  const tone = c === "critical" ? "red" : c === "high" ? "amber" : "muted";
  const label = c.charAt(0).toUpperCase() + c.slice(1);
  return <Badge tone={tone as "red" | "amber" | "muted"}>Criticality: {label}</Badge>;
}

function RcaBadge({ s }: { s: RcaState }) {
  if (!s) return null;
  if (s === "needed") return <Badge tone="amber">RCA needed</Badge>;
  if (s === "manager_confirmed") return <Badge tone="green">Root cause confirmed</Badge>;
  if (s === "technician_completed") return <Badge tone="info">RCA complete</Badge>;
  return <Badge tone="muted">RCA draft</Badge>;
}

function Action({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`text-[11px] font-medium rounded-md px-2 py-1 ${
        primary
          ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:brightness-110"
          : "border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {children}
    </Link>
  );
}

function Section({ title, href, empty, children }: { title: string; href: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{title}</h2>
        <Link href={href} className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-text)]">View all</Link>
      </div>
      {isEmpty ? <p className="text-[12.5px] text-[var(--color-faint)] py-1.5">{empty}</p> : <div className="space-y-2">{items}</div>}
    </section>
  );
}

function Row({ href, dot, text, sub }: { href?: string; dot: string; text: string; sub?: string }) {
  const inner = (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
      <span className="text-[13px] text-[var(--color-text)] truncate flex-1">{text}</span>
      {sub && <span className="text-[11px] text-[var(--color-faint)] shrink-0">{sub}</span>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-md hover:bg-[var(--color-surface-2)] px-1.5 -mx-1.5 transition-colors">{inner}</Link>
  ) : (
    <div className="px-1.5 -mx-1.5">{inner}</div>
  );
}
