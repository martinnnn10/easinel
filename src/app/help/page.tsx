"use client";

import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface Guide {
  icon: string;
  title: string;
  href?: string;
  what: string;
  steps: string[];
  tip?: string;
}

const LOOP = [
  "Machine goes down",
  "Diagnose with the Copilot",
  "Open a work order",
  "Repair & close with the cause",
  "Lesson is captured",
  "AI proposes a PM",
];

const GUIDES: Guide[] = [
  {
    icon: "✨",
    title: "Copilot — ask anything",
    href: "/",
    what: "Your AI maintenance technician. Describe a fault, paste an alarm code, or upload a manual/drawing/photo and get a structured, grounded answer.",
    steps: [
      "Type the problem (e.g. “PowerFlex 525 fault F081”) or click a suggested question.",
      "Attach files with the 📎 button — they’re indexed and used as context.",
      "Read the structured answer: probable causes, steps, parts, safety, confidence, and the sources it used.",
      "Click “Save as work order” to turn the diagnosis into a tracked job.",
    ],
    tip: "Answers are grounded in YOUR uploaded documents and repair history first, general knowledge last.",
  },
  {
    icon: "🧭",
    title: "Sessions — troubleshooting history",
    href: "/sessions",
    what: "Every Copilot conversation is saved as a session and becomes searchable organizational knowledge.",
    steps: [
      "Open Sessions to see past troubleshooting, newest first.",
      "Click any session to resume the full conversation.",
      "Sessions tied to an asset also appear on that asset’s profile.",
    ],
  },
  {
    icon: "🏭",
    title: "Equipment — the digital twin",
    href: "/assets",
    what: "Each machine gets a living profile: documents, drawings, PLC, photos, alarms, work orders, and its own AI conversation.",
    steps: [
      "Create an asset (name, manufacturer, model, criticality, location).",
      "Upload its manuals, drawings, and PLC exports to ground the Copilot for that machine.",
      "Ask asset-scoped questions like “Why has this failed three times?”",
    ],
  },
  {
    icon: "🛠️",
    title: "Work Orders — the daily loop",
    href: "/work-orders",
    what: "A real lifecycle: open → in progress → on hold → done, with true downtime and an append-only history.",
    steps: [
      "Create a work order (or save one from a Copilot answer) and assign it.",
      "Move it through its lifecycle; every change is recorded with who/when.",
      "Close it out with the resolution, root cause, failed part, and repair action.",
      "On a closed WO, click “Suggest PM” to start the prevention loop.",
    ],
    tip: "Capturing root cause + failed part on close is what powers the AI’s PM recommendation.",
  },
  {
    icon: "📅",
    title: "PM Program — AI-proposed, human-approved",
    href: "/pm",
    what: "Preventive maintenance born from real repairs — not a generic calendar. The AI proposes; a human approves.",
    steps: [
      "Close a corrective work order with its cause, then click “Suggest PM”.",
      "Review the draft: failure mode, cadence, task steps, parts, safety, confidence, and cited evidence.",
      "Approve to make it active (it gets a schedule) — or dismiss it.",
      "Mark PMs done as they’re completed; the next due date advances automatically.",
    ],
    tip: "The AI can only create drafts — nothing becomes an active PM without your approval.",
  },
  {
    icon: "⚡",
    title: "Parts — industrial search",
    href: "/parts",
    what: "A searchable parts catalog (the foundation for finding anything in the plant by number, manufacturer, or description).",
    steps: [
      "Add the spare parts your team stocks.",
      "Search by part number, manufacturer number, or free text.",
    ],
  },
  {
    icon: "📚",
    title: "Knowledge & PLC Explorer",
    href: "/knowledge",
    what: "Your indexed document library plus a structured PLC program browser.",
    steps: [
      "Drop in manuals, drawings, SOPs, alarm logs, and PLC exports — they’re auto-classified and indexed.",
      "Upload an L5X to open the full PLC Explorer (programs, routines, rungs, tags, cross-references).",
      "An .ACD is a compressed binary — export L5X from Studio 5000 (File → Save As → L5X) for full logic.",
    ],
    tip: "Studio 5000 is the only software that can convert .ACD → .L5X. The export takes ~30 seconds.",
  },
];

export default function HelpPage() {
  return (
    <>
      <TopBar title="How-To" subtitle="Get the most out of EAS Intelligence in a few minutes" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6">
          {/* The daily loop */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
            <h2 className="text-[15px] font-semibold">The daily loop</h2>
            <p className="text-[13px] text-[var(--color-muted)] mt-1">
              Everything in EAS supports one cycle. Each turn of it makes the system smarter.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {LOOP.map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="text-[12px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5">
                    {step}
                  </span>
                  {i < LOOP.length - 1 && <span className="text-[var(--color-faint)]">→</span>}
                </div>
              ))}
            </div>
          </section>

          {/* Quickstart */}
          <section className="rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-5 mb-6">
            <h2 className="text-[15px] font-semibold">5-minute quickstart</h2>
            <ol className="mt-3 space-y-1.5 text-[13px]">
              {[
                "Create an asset under Equipment.",
                "Upload that machine’s manual on its profile (or in Knowledge).",
                "Ask the Copilot a question about it — get a grounded answer.",
                "Save the answer as a work order; close it with the root cause.",
                "Click “Suggest PM”, review, and approve it.",
              ].map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-[var(--color-accent)] font-semibold">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Feature guides */}
          <div className="space-y-3">
            {GUIDES.map((g) => (
              <div key={g.title} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{g.icon}</span>
                    <h3 className="text-[14px] font-semibold">{g.title}</h3>
                  </div>
                  {g.href && (
                    <Link href={g.href} className="text-[12px] font-medium text-[var(--color-accent)] hover:underline shrink-0">
                      Open →
                    </Link>
                  )}
                </div>
                <p className="text-[12.5px] text-[var(--color-muted)] mt-2 leading-relaxed">{g.what}</p>
                <ol className="mt-3 space-y-1 text-[12.5px]">
                  {g.steps.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-[var(--color-faint)]">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
                {g.tip && (
                  <p className="text-[12px] text-[#f1d9a8] bg-[rgba(245,165,36,0.08)] border border-[var(--color-amber)]/25 rounded-lg px-3 py-2 mt-3">
                    💡 {g.tip}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Accounts & roles */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mt-6">
            <h2 className="text-[15px] font-semibold">Accounts, organizations & roles</h2>
            <p className="text-[12.5px] text-[var(--color-muted)] mt-2 leading-relaxed">
              Each plant signs up as an <strong className="text-[var(--color-text)]">organization</strong>;
              the first account is the owner. Invite your team under{" "}
              <strong className="text-[var(--color-text)]">Team &amp; Roles</strong> and assign roles —
              each controls what a person can do:
            </p>
            <div className="grid sm:grid-cols-2 gap-2 mt-3 text-[12px]">
              {[
                ["Owner / Admin", "Everything, incl. users, integrations & API keys"],
                ["Manager", "Work orders, PM programs, team skills"],
                ["Technician", "Create/close work orders, complete PMs, upload, ask"],
                ["Viewer", "Read-only + ask the Copilot"],
              ].map(([r, d]) => (
                <div key={r} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <div className="font-semibold">{r}</div>
                  <div className="text-[var(--color-muted)] mt-0.5">{d}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
