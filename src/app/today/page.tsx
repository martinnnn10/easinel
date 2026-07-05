"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface Today {
  machinesDown: { id: string; name: string; assetTag: string | null }[];
  pmsDue: { id: string; title: string; assetId: string | null }[];
  stats: { open: number; inProgress: number; closedThisShift: number; pmsDue: number };
  openCritical: { id: string; number: string | null; title: string; priority: string; assetId: string | null }[];
  recentClosed: { id: string; number: string | null; title: string; closedAt: number | null }[];
  handoverNotes: { id: string; note: string; category: string; priority: string; assetName?: string | null }[];
  recentSessions: { id: string; title: string; updatedAt: number }[];
}

const priDot: Record<string, string> = { urgent: "var(--color-red)", high: "var(--color-amber)", medium: "var(--color-muted)", low: "var(--color-faint)" };

export default function TodayPage() {
  const [d, setD] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
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
            <Link href="/" className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110">Ask Copilot</Link>
            <Link href="/work-orders" className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]">Create work order</Link>
            <Link href="/handover" className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]">Add handover note</Link>
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
              {/* One restrained status line — not a wall of KPI cards */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] mb-7 text-[var(--color-muted)]">
                <span><strong className="text-[var(--color-text)]">{d.machinesDown.length}</strong> down</span>
                <span><strong className="text-[var(--color-text)]">{d.stats.open}</strong> open</span>
                <span><strong className="text-[var(--color-text)]">{d.stats.inProgress}</strong> in progress</span>
                <span><strong className={d.stats.pmsDue > 0 ? "text-[var(--color-amber)]" : "text-[var(--color-text)]"}>{d.stats.pmsDue}</strong> PMs due</span>
                <span><strong className="text-[var(--color-text)]">{d.stats.closedThisShift}</strong> closed today</span>
              </div>

              <div className="grid md:grid-cols-2 gap-x-8 gap-y-7">
                {/* Needs attention */}
                <Section title="Machines down" href="/assets" empty="Nothing down right now.">
                  {d.machinesDown.map((m) => (
                    <Row key={m.id} href={`/assets/${m.id}`} dot="var(--color-red)" text={m.name} sub={m.assetTag ?? undefined} />
                  ))}
                </Section>

                <Section title="Open critical work" href="/work-orders" empty="No open work.">
                  {d.openCritical.map((w) => (
                    <Row key={w.id} href={`/work-orders/${w.id}`} dot={priDot[w.priority]} text={w.title} sub={w.number ?? w.priority} />
                  ))}
                </Section>

                <Section title="PMs due" href="/pm" empty="No PMs due.">
                  {d.pmsDue.map((p) => (
                    <Row key={p.id} href={`/pm/${p.id}`} dot="var(--color-amber)" text={p.title} />
                  ))}
                </Section>

                <Section title="Shift handover" href="/handover" empty="No handover notes in the last 24h.">
                  {d.handoverNotes.map((n) => (
                    <Row key={n.id} dot={priDot[n.priority] ?? "var(--color-muted)"} text={n.note} sub={n.assetName ?? undefined} />
                  ))}
                </Section>

                <Section title="Recent Copilot sessions" href="/sessions" empty="No recent sessions.">
                  {d.recentSessions.map((s) => (
                    <Row key={s.id} href={`/?c=${s.id}`} dot="var(--color-accent)" text={s.title} sub={new Date(s.updatedAt).toLocaleDateString()} />
                  ))}
                </Section>

                <Section title="Recently closed" href="/work-orders" empty="Nothing closed recently.">
                  {d.recentClosed.map((w) => (
                    <Row key={w.id} href={`/work-orders/${w.id}`} dot="var(--color-green)" text={w.title} sub={w.number ?? undefined} />
                  ))}
                </Section>
              </div>
            </>
          )}
        </div>
      </div>
    </>
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
      {isEmpty ? (
        <p className="text-[12.5px] text-[var(--color-faint)] py-1.5">{empty}</p>
      ) : (
        <div className="space-y-0.5">{items}</div>
      )}
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
