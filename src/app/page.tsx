import type { Metadata } from "next";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC MARKETING SITE — the root route. No login required, no app chrome.
// The logged-in product lives behind /login → /today; the Copilot at /copilot.
//
// Positioning: AI maintenance intelligence that turns every breakdown into
// permanent machine knowledge. Written in maintenance language — no generic
// SaaS copy. One idea per section, calm graphite, industrial seriousness.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "EAS Maintenance Intelligence — Stop solving the same breakdown twice",
  description:
    "When a machine goes down, EAS helps your team diagnose the issue, capture the repair, learn from the root cause, and prevent the failure from repeating.",
};

// Single place to change the pilot-request address.
const PILOT_MAILTO =
  "mailto:eas@eautomatedstaffing.com?subject=EAS%20pilot%20request&body=Plant%2Fsite%3A%0AHighest-downtime%20line%20or%20asset%3A%0ATeam%20size%3A%0A";

export default function MarketingHome() {
  return (
    <div className="h-full overflow-y-auto scroll-smooth">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-40 border-b border-[var(--color-border-soft)] bg-[var(--color-bg)]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold text-sm">
              E
            </div>
            <span className="text-[14px] font-semibold tracking-tight">
              EAS <span className="text-[var(--color-muted)] font-medium">Maintenance Intelligence</span>
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-5 text-[13px] text-[var(--color-muted)]">
            <a href="#loop" className="hover:text-[var(--color-text)]">How it works</a>
            <a href="#product" className="hover:text-[var(--color-text)]">Product</a>
            <a href="#trust" className="hover:text-[var(--color-text)]">Trust</a>
          </nav>
          <Link href="/login" className="text-[13px] font-medium text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Sign in
          </Link>
          <a
            href={PILOT_MAILTO}
            className="text-[13px] font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-3.5 py-1.5 hover:brightness-110"
          >
            Book a pilot
          </a>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="border-b border-[var(--color-border-soft)]">
        <div className="max-w-6xl mx-auto px-5 pt-20 pb-16 sm:pt-28 sm:pb-20 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            AI maintenance intelligence for industrial teams
          </p>
          <h1 className="mt-4 text-[34px] sm:text-[52px] leading-[1.08] font-semibold tracking-tight max-w-3xl mx-auto">
            Stop solving the same breakdown twice.
          </h1>
          <p className="mt-5 text-[15px] sm:text-[17px] leading-relaxed text-[var(--color-muted)] max-w-2xl mx-auto">
            EAS turns every repair, manual, work order, drawing, and technician note into
            machine memory your team can use the next time equipment goes down.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a
              href={PILOT_MAILTO}
              className="text-[14px] font-semibold rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] px-6 py-3 hover:brightness-110"
            >
              Book a pilot
            </a>
            <a
              href="#loop"
              className="text-[14px] font-medium rounded-xl border border-[var(--color-border)] px-6 py-3 text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]"
            >
              See how it works
            </a>
          </div>

          {/* Hero product visual — the loop in one glance: machine down →
              Copilot diagnosis → work order → root cause → PM suggested. */}
          <div className="mt-14 max-w-4xl mx-auto text-left">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl shadow-black/40 overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[var(--color-border-soft)]">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-surface-2)]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-surface-2)]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-surface-2)]" />
                <span className="ml-3 text-[11px] text-[var(--color-faint)]">EAS Copilot · Line 2 Packer</span>
              </div>
              <div className="grid md:grid-cols-5">
                {/* Copilot exchange */}
                <div className="md:col-span-3 p-5 border-b md:border-b-0 md:border-r border-[var(--color-border-soft)]">
                  <div className="flex justify-end">
                    <p className="text-[13px] rounded-xl bg-[var(--color-surface-2)] px-3.5 py-2 max-w-[85%]">
                      Line 2 packer trips on F070 about 20 minutes after startup. Third time this month.
                    </p>
                  </div>
                  <div className="mt-4 text-[13px] leading-relaxed">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-1.5">
                      What to check first
                    </p>
                    <ol className="list-decimal pl-5 space-y-1 text-[var(--color-text)]">
                      <li>Drive panel cooling fan and filter — F070 after warm-up points to thermal, not load.</li>
                      <li>Compare motor FLA to the overload setting recorded on the last repair.</li>
                      <li>This machine had the same fault on <span className="font-medium">WO-1042</span> — failed part was the panel fan.</li>
                    </ol>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      <Cite>PowerFlex 525 manual · p.214</Cite>
                      <Cite>WO-1042 · same fault, 3 weeks ago</Cite>
                      <Cite>Lesson — F070 after warm-up</Cite>
                    </div>
                  </div>
                </div>
                {/* Outcome column */}
                <div className="md:col-span-2 p-5 space-y-3 bg-[var(--color-bg-2)]/40">
                  <MiniCard label="Work order" title="WO-1077 — F070 trip after warm-up" meta="In progress · Line 2 Packer" tone="amber" />
                  <MiniCard label="Root cause captured" title="Panel cooling fan seized — drive overheating" meta="Failed part: 120mm panel fan" tone="green" />
                  <MiniCard label="PM suggested" title="Monthly drive-panel filter & fan check" meta="Draft — awaiting supervisor approval" tone="accent" />
                </div>
              </div>
            </div>
            <p className="text-center text-[12px] text-[var(--color-faint)] mt-3">
              One breakdown, handled once — diagnosed, repaired, remembered, and prevented.
            </p>
          </div>
        </div>
      </section>

      {/* ── Pain ── */}
      <section className="border-b border-[var(--color-border-soft)]">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24 grid md:grid-cols-2 gap-10 items-start">
          <div>
            <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight leading-tight">
              Your best maintenance knowledge is trapped in people&apos;s heads.
            </h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--color-muted)]">
              Every plant has the tech who just <em>knows</em> that machine. When they&apos;re on
              the other shift — or gone — the same breakdown takes hours instead of minutes.
              The knowledge existed. It was never captured anywhere the next person could use.
            </p>
          </div>
          <ul className="space-y-2.5 text-[14px]">
            {[
              "The same failure repeats, and each time someone re-diagnoses it from scratch.",
              "Work order history says “fixed” — not what the root cause was or which part failed.",
              "The OEM manual has the answer on page 214. Nobody opens it at 2 AM.",
              "PMs run on the calendar, not on how the equipment actually fails.",
              "New technicians start from zero. Supervisors chase updates instead of preventing downtime.",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-4 py-3">
                <span className="text-[var(--color-amber)] shrink-0 mt-0.5">▪</span>
                <span className="text-[var(--color-text)]">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── The loop ── */}
      <section id="loop" className="border-b border-[var(--color-border-soft)] scroll-mt-14">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight">
              Every breakdown makes your team smarter.
            </h2>
            <p className="mt-3 text-[14.5px] text-[var(--color-muted)] leading-relaxed">
              EAS runs one loop, over and over. Each turn of it leaves the plant knowing more
              than it did before the failure.
            </p>
          </div>
          <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ["Machine goes down", "A technician reports the symptom the way they'd say it out loud."],
              ["Ask the Copilot", "It searches this machine's history, manuals, drawings, PMs, and prior repairs — and says what to check first, with citations."],
              ["Work the repair", "A work order tracks the job: status, parts, downtime, shift handover."],
              ["Close with the cause", "Root cause, failed part, and repair action are captured in one 60-second close-out."],
              ["Memory updates", "The repair becomes a retrievable lesson attached to that machine — permanently."],
              ["Prevention follows", "EAS drafts a PM from the real failure. A supervisor approves before anything schedules."],
              ["Trends surface", "Repeat faults, failing parts, and downtime patterns show up before they become the norm."],
              ["Next tech solves faster", "The next person who hits this fault starts from the answer, not from zero."],
            ].map(([title, body], i) => (
              <li key={title} className="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                <span className="text-[11px] font-mono text-[var(--color-accent)]">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-[14px] font-semibold mt-1.5">{title}</h3>
                <p className="text-[12.5px] text-[var(--color-muted)] mt-1 leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Product pillars ── */}
      <section id="product" className="border-b border-[var(--color-border-soft)] scroll-mt-14">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight">
              EAS gives every machine a memory.
            </h2>
            <p className="mt-3 text-[14.5px] text-[var(--color-muted)]">
              Four pieces, one system — built around the machine, not around forms.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 gap-4">
            <Pillar
              title="AI Copilot"
              lead="An AI technician that has actually read your plant."
              items={[
                "Answers maintenance questions in plain language",
                "Cites your manuals, drawings, and this machine's repair history",
                "Safety-first: lock-out steps before live checks, never guesses",
              ]}
            />
            <Pillar
              title="Machine Memory"
              lead="Every asset carries its own history."
              items={[
                "Past failures, root causes, and failed parts in one place",
                "Lessons learned captured automatically at close-out",
                "Manuals, drawings, PLC programs, and parts — attached to the machine",
              ]}
            />
            <Pillar
              title="Work Execution"
              lead="The daily work, without the paperwork feel."
              items={[
                "Work orders with approval flow and work packages",
                "Editable shift handover so nothing dies between shifts",
                "Close-out that captures root cause in under a minute",
              ]}
            />
            <Pillar
              title="Prevention"
              lead="PMs that come from real failures, not the calendar."
              items={[
                "AI-suggested PMs drafted from actual repair history",
                "Failure trends and repeat-issue tracking per machine",
                "Human approval before any AI-generated PM goes live",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ── Not another CMMS ── */}
      <section className="border-b border-[var(--color-border-soft)]">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight">
              CMMS systems store maintenance data. EAS learns from it.
            </h2>
          </div>
          <div className="mt-12 grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
            <div className="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-6">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
                A traditional CMMS
              </h3>
              <ul className="mt-4 space-y-2.5 text-[13.5px] text-[var(--color-muted)]">
                {[
                  "Stores work orders after the fact",
                  "Depends on perfect data entry",
                  "Hard to search when a machine is down",
                  "Rarely helps during the breakdown itself",
                  "Never learns from the repairs it stores",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5"><span className="text-[var(--color-faint)]">—</span>{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.04] p-6">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
                EAS
              </h3>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                {[
                  "Helps diagnose while the machine is still down",
                  "Explains what to check first — and why",
                  "Cites your own manuals, drawings, and history",
                  "Captures root cause at close-out",
                  "Builds machine memory and suggests prevention",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5"><span className="text-[var(--color-accent)]">✓</span>{t}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-center text-[13px] text-[var(--color-muted)] mt-8 max-w-xl mx-auto">
            EAS sits beside the CMMS you already run — or grows into your maintenance system
            of record. Either way, the knowledge stops leaking.
          </p>
        </div>
      </section>

      {/* ── Product screens ── */}
      <section className="border-b border-[var(--color-border-soft)]">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight">
              A calm operating system for the maintenance day.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <Screen caption="Today — what's down, what's due, what to do next.">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-faint)] mb-2">Today</p>
              <div className="space-y-1.5">
                <ScreenRow dot="var(--color-red)" text="Line 2 Packer — down · F070" right="Ask Copilot" />
                <ScreenRow dot="var(--color-amber)" text="WO-1077 — drive overheating" right="In progress" />
                <ScreenRow dot="var(--color-accent)" text="PM due — conveyor gearbox oil" right="Generate WO" />
                <ScreenRow dot="var(--color-green)" text="WO-1074 — closed · root cause captured" right="Done" />
              </div>
            </Screen>
            <Screen caption="Copilot — grounded answers with citations, not guesses.">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-faint)] mb-2">Copilot</p>
              <p className="text-[12px] leading-relaxed">
                <span className="text-[var(--color-muted)]">What to check first:</span> panel cooling
                fan and filter. This machine failed the same way on WO-1042.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <Cite>Manual p.214</Cite>
                <Cite>WO-1042</Cite>
              </div>
            </Screen>
            <Screen caption="Close-out — root cause and failed part become machine memory.">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-faint)] mb-2">Close out</p>
              <div className="space-y-2 text-[12px]">
                <div><span className="text-[var(--color-faint)]">Root cause</span><p>Panel fan seized</p></div>
                <div><span className="text-[var(--color-faint)]">Failed part</span><p>120mm panel fan</p></div>
                <div><span className="text-[var(--color-faint)]">Repair action</span><p>Replaced fan, cleaned filter</p></div>
              </div>
            </Screen>
          </div>
        </div>
      </section>

      {/* ── Trust ── */}
      <section id="trust" className="border-b border-[var(--color-border-soft)] scroll-mt-14">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-tight">
              Built for plants, not demos.
            </h2>
            <p className="mt-3 text-[14.5px] text-[var(--color-muted)]">
              Industrial teams need software they can trust with their operations — and an AI
              they can trust next to live equipment.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ["Grounded answers only", "The Copilot cites your manuals, drawings, and repair history. When it doesn't know, it says so."],
              ["Safety first", "Troubleshooting steps sequence lock-out/tag-out before any live check. The AI advises — your people decide."],
              ["Human approval for AI PMs", "AI-drafted preventive maintenance stays a draft until a supervisor approves it."],
              ["Org isolation", "Every record is scoped to your organization. Your data never trains or answers anyone else."],
              ["Role-based access", "Owner, admin, manager, and technician roles gate who can approve, edit, and administer."],
              ["Honest fallback", "If the live AI is unavailable, EAS says so and falls back to deterministic, document-grounded answers — never silently."],
              ["AI usage controls", "Per-organization AI quotas, model tiering, and cost reporting keep usage predictable."],
              ["No demo data in production", "Your workspace starts clean. Sample scenarios exist only in the isolated demo org."],
              ["Your data stays recoverable", "Payment issues never delete or hide your maintenance history."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4">
                <h3 className="text-[13.5px] font-semibold">{t}</h3>
                <p className="text-[12.5px] text-[var(--color-muted)] mt-1 leading-relaxed">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section>
        <div className="max-w-6xl mx-auto px-5 py-20 sm:py-28 text-center">
          <h2 className="text-[28px] sm:text-[36px] font-semibold tracking-tight max-w-2xl mx-auto">
            Run a pilot on one production line.
          </h2>
          <p className="mt-4 text-[14.5px] text-[var(--color-muted)] max-w-xl mx-auto leading-relaxed">
            Start with your highest-downtime assets. Load the manuals, wire in the work, and
            watch the machine memory build with every repair.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a
              href={PILOT_MAILTO}
              className="text-[14px] font-semibold rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] px-6 py-3 hover:brightness-110"
            >
              Book a pilot
            </a>
            <Link
              href="/login"
              className="text-[14px] font-medium rounded-xl border border-[var(--color-border)] px-6 py-3 text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--color-border-soft)]">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center gap-3 text-[12px] text-[var(--color-faint)]">
          <span className="mr-auto">© {new Date().getFullYear()} EAS Maintenance Intelligence</span>
          <a href="#loop" className="hover:text-[var(--color-muted)]">How it works</a>
          <a href="#trust" className="hover:text-[var(--color-muted)]">Trust</a>
          <Link href="/login" className="hover:text-[var(--color-muted)]">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}

// ───────────────────────── Marketing building blocks ─────────────────────────

function Cite({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
      {children}
    </span>
  );
}

function MiniCard({ label, title, meta, tone }: { label: string; title: string; meta: string; tone: "amber" | "green" | "accent" }) {
  const color = tone === "amber" ? "var(--color-amber)" : tone === "green" ? "var(--color-green)" : "var(--color-accent)";
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-3">
      <p className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color }}>{label}</p>
      <p className="text-[12.5px] font-medium mt-1 leading-snug">{title}</p>
      <p className="text-[11px] text-[var(--color-faint)] mt-0.5">{meta}</p>
    </div>
  );
}

function Pillar({ title, lead, items }: { title: string; lead: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-6">
      <h3 className="text-[16px] font-semibold">{title}</h3>
      <p className="text-[13px] text-[var(--color-muted)] mt-1">{lead}</p>
      <ul className="mt-4 space-y-2 text-[13px]">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5">
            <span className="text-[var(--color-accent)] shrink-0">·</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Screen({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure>
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 min-h-[150px]">
        {children}
      </div>
      <figcaption className="text-[12px] text-[var(--color-muted)] mt-2.5 px-1">{caption}</figcaption>
    </figure>
  );
}

function ScreenRow({ dot, text, right }: { dot: string; text: string; right: string }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
      <span className="truncate flex-1">{text}</span>
      <span className="text-[var(--color-faint)] shrink-0">{right}</span>
    </div>
  );
}
