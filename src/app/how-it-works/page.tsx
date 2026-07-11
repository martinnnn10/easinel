// How It Works — the buyer/onboarding explainer for the EAS product loop.
//
// TRUST RULE: this page is 100% static teaching content. It renders NOTHING
// from the org's database and WRITES nothing — no assets, work orders, PMs,
// documents, reuse events, conversations, or metrics. The one worked example
// (F070) is hard-coded and clearly labeled "Example only — not your plant
// data", so a buyer understands the loop without any seeded/fake data polluting
// the real workspace. Operational pages (Today, Reliability, ROI, Reuse Impact,
// PM, Work Orders, Copilot) stay real-data-only; the teaching lives here.

import Link from "next/link";
import { TopBar } from "@/components/TopBar";

export const dynamic = "force-static";

const STEPS = [
  { n: 1, title: "Add a machine", body: "Create the asset. Its failures, documents, and a dedicated Copilot all attach here." },
  { n: 2, title: "Upload manuals & drawings", body: "PDFs, electrical drawings, PLC exports. The Copilot cites YOUR documents by page." },
  { n: 3, title: "Ask the Copilot", body: "Describe a fault or paste an alarm code. Answers are grounded in this machine's history and docs." },
  { n: 4, title: "Create a work order", body: "Capture the symptom the moment the machine goes down — from the floor, on a phone." },
  { n: 5, title: "Close with root cause + fix", body: "Record what actually failed and what fixed it. This is the moment machine memory is created." },
  { n: 6, title: "Turn the fix into memory", body: "That close-out becomes reusable: next time the same fault appears, the prior fix surfaces at intake." },
  { n: 7, title: "Detect repeat failures", body: "When a fault recurs on a machine, EAS flags it as a chronic repeat-risk instead of letting it hide." },
  { n: 8, title: "Suggest a PM from history", body: "One tap turns a recurring failure into a preventive maintenance draft — born from real repairs, not a template." },
  { n: 9, title: "Show reliability impact", body: "Once there's enough real history, the Reliability Report proves downtime avoided — measured against each machine's own median." },
];

const F070 = [
  { tag: "Copilot", tone: "info", title: "F070 trip on the wrapper drive, ~20 min after startup", body: "Checks the drive first, not the motor: input power and phase balance, the 24 VDC control supply, then field wiring — and pulls this machine's prior F070 repairs into the answer." },
  { tag: "Work order", tone: "amber", title: "WO opened — “Wrapper drive F070 trip after warm-up”", body: "Symptom captured at the machine; the drive and prior history are already in context." },
  { tag: "Root cause captured", tone: "green", title: "Cooling fan filter clogged → drive overtemp → F070", body: "Failed part and corrective action recorded on close-out. This becomes machine memory." },
  { tag: "PM suggested", tone: "accent", title: "Monthly drive-panel filter & fan check — draft", body: "Generated from the recurring failure, awaiting a supervisor's approval. Never auto-activated." },
];

export default function HowItWorks() {
  return (
    <div className="h-full flex flex-col">
      <TopBar title="How It Works" subtitle="The EAS loop — how every repair becomes machine memory" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 py-8">
          {/* Section 1 — the problem */}
          <section className="text-center max-w-2xl mx-auto">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">How EAS works</p>
            <h1 className="text-2xl sm:text-[32px] font-bold tracking-tight leading-tight mt-2">
              Stop solving the same breakdown twice.
            </h1>
            <p className="text-[15px] text-[var(--color-muted)] mt-3 leading-relaxed">
              Most plants fix the same breakdown over and over because the machine forgets. The tech who solved it
              last time is on another shift, and the fix lived in their head. EAS makes every repair permanent,
              searchable knowledge — so the next person starts where the last one finished.
            </p>
          </section>

          {/* Section 2 — the loop */}
          <section className="mt-10">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">The loop</h2>
              <p className="text-[15px] mt-1">
                <span className="font-semibold">Every repair becomes machine memory</span> — and the loop compounds each time equipment goes down.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px]">
                {["Machine down", "Ask Copilot", "Work order", "Close with root cause", "Machine memory", "Repeat-risk caught", "PM suggested", "Reliability proven"].map((s, i, arr) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-2)] px-2.5 py-1">{s}</span>
                    {i < arr.length - 1 && <span className="text-[var(--color-faint)]">→</span>}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Section 3 — step by step */}
          <section className="mt-10">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-3">Step by step</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {STEPS.map((s) => (
                <div key={s.n} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] grid place-items-center text-[12px] font-bold shrink-0">{s.n}</span>
                    <h3 className="text-[13px] font-semibold">{s.title}</h3>
                  </div>
                  <p className="text-[12px] text-[var(--color-muted)] mt-2 leading-snug">{s.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section 4 — worked example (clearly labeled, no real data) */}
          <section className="mt-10">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Example walkthrough</h2>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-amber)]/40 bg-[color-mix(in_srgb,var(--color-amber)_12%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-amber)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" />
                Example only — not your plant data
              </span>
            </div>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              {F070.map((c, i) => (
                <div key={c.tag} className={`flex gap-3 p-4 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
                  <ToneDot tone={c.tone} />
                  <div className="min-w-0">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: toneColor(c.tone) }}>{c.tag}</p>
                    <p className="text-[13px] font-medium mt-0.5">{c.title}</p>
                    <p className="text-[12px] text-[var(--color-muted)] mt-0.5 leading-snug">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-faint)] mt-2">
              Illustration of the loop on a sample fault. Your workspace shows only your plant&apos;s real machines and repairs.
            </p>
          </section>

          {/* Section 5 — call to action (into the real product) */}
          <section className="mt-10 mb-4">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 text-center">
              <h2 className="text-[17px] font-semibold">Start your machine memory</h2>
              <p className="text-[13px] text-[var(--color-muted)] mt-1">
                Your workspace shows real plant data only — it fills in as you work the loop above.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Link href="/assets" className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 hover:brightness-110">
                  Add your first asset
                </Link>
                <Link href="/knowledge" className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">
                  Upload your first manual
                </Link>
                <Link href="/copilot" className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">
                  Ask the Copilot
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function toneColor(tone: string): string {
  return tone === "info" ? "var(--color-info)" : tone === "amber" ? "var(--color-amber)" : tone === "green" ? "var(--color-green)" : "var(--color-accent)";
}
function ToneDot({ tone }: { tone: string }) {
  return <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: toneColor(tone) }} />;
}
