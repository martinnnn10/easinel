"use client";

// ─────────────────────────────────────────────────────────────────────────
// PM Program detail view. Every PM card on /pm links here. Renders the full
// program: title, cadence, asset (or an explicit "Unassigned" call-to-action),
// ordered task steps, tools, parts, safety steps, estimated labor, the source
// documents / grounding excerpts (citations), the AI rationale, the approval
// status, and — gated by manage_pm — the Approve / Dismiss controls.
//
// Reads GET /api/pm/:id (already returns the full PmProgramDetail) and acts via
// PATCH /api/pm/:id {action:"approve"|"archive"}.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { can, type Role } from "@/lib/auth/roles";

interface TaskDetail {
  title?: string;
  purpose?: string;
  operatingState?: string;
  safety?: string[];
  ppe?: string[];
  tools?: string[];
  parts?: string[];
  procedure?: string[];
  measurements?: string[];
  acceptanceCriteria?: string[];
  outOfSpecAction?: string;
  estMinutes?: number;
  skillLevel?: string;
  oemRefs?: string[];
  standards?: string[];
  failureModes?: string[];
  isLotoTransition?: boolean;
}
interface Task { id: string; ordinal: number; instruction: string; detail?: TaskDetail | null }
interface Evidence { kind: string; refId: string | null; detail: string | null }
interface Schedule { intervalDays: number; nextDueAt: number | null; active: boolean }
interface Completion { id: string; status: string; completedAt: number; notes: string | null }
interface Program {
  id: string;
  title: string;
  assetId: string | null;
  assetName: string | null;
  failureMode: string | null;
  frequencyLabel: string | null;
  intervalDays: number | null;
  status: string;
  estLaborMins: number | null;
  tools: string | null;
  parts: string | null;
  safety: string | null;
  reasoning: string | null;
  confidence: string | null;
  source: string;
  approvedBy: string | null;
  approvedAt: number | null;
  createdAt: number | null;
  tasks: Task[];
  evidence: Evidence[];
  schedule: Schedule | null;
  completions: Completion[];
}

const statusStyle: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Draft — awaiting approval", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  active: { label: "Active", color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  archived: { label: "Dismissed", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const evidenceLabel: Record<string, string> = {
  work_order: "Work order",
  lesson: "Lesson learned",
  manual: "Manual / document",
  pm_history: "PM history",
  oem: "OEM reference",
  model: "Model knowledge",
};

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

export default function PmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [pm, setPm] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState<null | "approve" | "archive">(null);

  const load = useCallback(() => {
    setError(null);
    return fetch(`/api/pm/${id}`)
      .then((r) => {
        if (r.status === 404) throw new Error("not_found");
        if (!r.ok) throw new Error("load");
        return r.json();
      })
      .then((d: { program: Program }) => setPm(d.program))
      .catch((e) => setError((e as Error).message === "not_found" ? "not_found" : "load"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? null))
      .catch(() => setRole(null));
  }, [load]);

  const act = async (action: "approve" | "archive") => {
    setBusy(action);
    try {
      const r = await fetch(`/api/pm/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error("action_failed");
      await load();
    } catch {
      setError("action_failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <CenterNote>Loading PM program…</CenterNote>;
  if (error === "not_found")
    return (
      <CenterNote>
        PM program not found. <Link href="/pm" className="text-[var(--color-accent)]">← Back to PM programs</Link>
      </CenterNote>
    );
  if (error === "load" || !pm)
    return (
      <div className="grid place-items-center h-full text-center">
        <div>
          <p className="text-[var(--color-red)] text-sm">We couldn&apos;t load this PM program.</p>
          <button onClick={() => { setLoading(true); load(); }} className="mt-3 text-[13px] rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">Retry</button>
        </div>
      </div>
    );

  const st = statusStyle[pm.status] ?? statusStyle.draft;
  const tools = parseList(pm.tools);
  const parts = parseList(pm.parts);
  const safety = parseList(pm.safety);
  const canManage = role ? can(role, "manage_pm") : false;
  const cadence = pm.frequencyLabel || (pm.intervalDays ? `Every ${pm.intervalDays} days` : "—");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-5 py-5">
        <Link href="/pm" className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]">← PM programs</Link>

        {/* Header */}
        <div className="mt-3 flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold tracking-tight">{pm.title}</h1>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="px-2 py-1 rounded-full font-medium" style={{ color: st.color, background: st.bg }}>{st.label}</span>
              <span className="px-2 py-1 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)]">{cadence}</span>
              {pm.confidence && (
                <span className="px-2 py-1 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] capitalize">{pm.confidence} confidence</span>
              )}
              {pm.source === "ai_suggested" && (
                <span className="px-2 py-1 rounded-full bg-[var(--color-surface-2)] text-[var(--color-faint)]">AI-suggested draft</span>
              )}
            </div>
          </div>

          {canManage && pm.status === "draft" && (
            <div className="flex gap-2">
              <button
                onClick={() => act("approve")}
                disabled={busy !== null}
                className="text-[13px] rounded-lg px-3.5 py-2 font-medium text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50"
              >
                {busy === "approve" ? "Approving…" : "Approve & schedule"}
              </button>
              <button
                onClick={() => act("archive")}
                disabled={busy !== null}
                className="text-[13px] rounded-lg px-3.5 py-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                {busy === "archive" ? "Dismissing…" : "Dismiss"}
              </button>
            </div>
          )}
        </div>

        {error === "action_failed" && (
          <p className="mt-3 text-[12px] text-[var(--color-red)]">That action failed. Please retry.</p>
        )}

        {/* Approval gate hint for non-managers */}
        {!canManage && pm.status === "draft" && (
          <div className="mt-3 rounded-lg p-3 text-[12px]" style={{ background: "rgba(245,158,11,0.10)", color: "#f59e0b" }}>
            This PM is a draft. Only a maintenance manager/supervisor can approve it before it schedules work.
          </div>
        )}

        {/* Asset assignment */}
        <Section title="Asset">
          {pm.assetId ? (
            <Link href={`/assets/${pm.assetId}`} className="inline-flex items-center gap-2 text-[14px] text-[var(--color-accent)] hover:underline">
              {pm.assetName || "View asset"}
            </Link>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#f59e0b" }} /> Unassigned
              </span>
              <span className="text-[12px] text-[var(--color-muted)]">This PM is not linked to a machine yet.</span>
              {role && (can(role, "manage_assets") || can(role, "manage_pm")) && (
                <button
                  onClick={() => router.push(`/pm/${id}/assign`)}
                  className="text-[12px] rounded-lg px-3.5 py-1.5 font-medium text-white bg-[var(--color-accent)] hover:opacity-90"
                >
                  Assign to a machine →
                </button>
              )}
            </div>
          )}
        </Section>

        {/* Key facts */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Fact label="Cadence" value={cadence} />
          <Fact label="Est. labor" value={pm.estLaborMins != null ? `${pm.estLaborMins} min` : "—"} />
          <Fact label="Task steps" value={String(pm.tasks.length)} />
          <Fact label="Prevents" value={pm.failureMode || "—"} />
        </div>

        {/* Task steps — operating-state sequenced, structured procedure */}
        <Section title={`Procedure — ${pm.tasks.length} steps (operating-state sequenced)`}>
          {pm.tasks.length === 0 ? (
            <Empty>No task steps recorded.</Empty>
          ) : (
            <ol className="space-y-2.5">
              {pm.tasks.map((t, i) => (
                <StepCard key={t.id} index={i + 1} task={t} />
              ))}
            </ol>
          )}
        </Section>

        {/* Tools / Parts / Safety */}
        <div className="mt-4 grid sm:grid-cols-3 gap-3">
          <ChipCard title="Tools" items={tools} accent="var(--color-amber)" />
          <ChipCard title="Parts" items={parts} accent="var(--color-green)" />
          <ChipCard title="Safety steps" items={safety} accent="var(--color-red)" />
        </div>

        {/* AI rationale */}
        {pm.reasoning && (
          <Section title="Why this PM">
            <p className="text-[13px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap">{pm.reasoning}</p>
          </Section>
        )}

        {/* Source documents / grounding citations */}
        <Section title={`Source & grounding (${pm.evidence.length})`}>
          {pm.evidence.length === 0 ? (
            <Empty>No source citations recorded for this PM.</Empty>
          ) : (
            <ul className="space-y-2">
              {pm.evidence.map((e, i) => (
                <li key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">{evidenceLabel[e.kind] ?? e.kind}</div>
                  {e.detail && <div className="mt-1 text-[12px] text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">{e.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Approval / lifecycle footer */}
        <Section title="Status">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
            <Fact inline label="Approval" value={st.label} />
            {pm.approvedBy && <Fact inline label="Approved by" value={pm.approvedBy} />}
            {pm.approvedAt && <Fact inline label="Approved" value={new Date(pm.approvedAt).toISOString().slice(0, 10)} />}
            {pm.schedule?.nextDueAt && <Fact inline label="Next due" value={new Date(pm.schedule.nextDueAt).toISOString().slice(0, 10)} />}
            {pm.createdAt && <Fact inline label="Created" value={new Date(pm.createdAt).toISOString().slice(0, 10)} />}
          </dl>
          {pm.completions.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)] mb-1">Completion history</div>
              <ul className="space-y-1 text-[12px] text-[var(--color-muted)]">
                {pm.completions.map((c) => (
                  <li key={c.id}>{new Date(c.completedAt).toISOString().slice(0, 10)} — {c.status}{c.notes ? `: ${c.notes}` : ""}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center h-full text-[var(--color-muted)] text-sm text-center px-4">{children}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="text-[12px] uppercase tracking-wide text-[var(--color-muted)] mb-2">{title}</h2>
      {children}
    </section>
  );
}
function Fact({ label, value, inline }: { label: string; value: string; inline?: boolean }) {
  if (inline) {
    return (
      <div className="min-w-0">
        <dt className="text-[var(--color-faint)] text-[10px] uppercase tracking-wide">{label}</dt>
        <dd className="truncate text-[var(--color-text)]">{value}</dd>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-[14px] font-semibold tracking-tight truncate">{value}</div>
      <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{label}</div>
    </div>
  );
}
function ChipCard({ title, items, accent }: { title: string; items: string[]; accent: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)] mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">None specified.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-[12px] px-2 py-1 rounded-md bg-[var(--color-surface-2)]" style={{ borderLeft: `2px solid ${accent}` }}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-[var(--color-faint)] py-3">{children}</p>;
}

// Operating-state badge color: running/observation = green, LOTO/contact = red,
// stopped = amber. This makes the safety sequencing visible at a glance.
function stateStyle(state?: string): { color: string; bg: string } {
  const s = (state || "").toLowerCase();
  if (s.includes("loto")) return { color: "#ef4444", bg: "rgba(239,68,68,0.12)" };
  if (s.includes("running")) return { color: "#34d399", bg: "rgba(52,211,153,0.12)" };
  if (s.includes("stopped")) return { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" };
  return { color: "#9ca3af", bg: "rgba(156,163,175,0.12)" };
}

function StepList({ label, items, accent }: { label: string; items?: string[]; accent?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-faint)] mb-1">{label}</div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-[12px] text-[var(--color-muted)] leading-relaxed pl-3 relative">
            <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: accent || "var(--color-faint)" }} />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

// A single structured procedure step. Falls back to just the instruction line
// when no structured detail is present (legacy rows).
function StepCard({ index, task }: { index: number; task: Task }) {
  const [open, setOpen] = useState(true);
  const d = task.detail || null;
  const title = (d?.title) || task.instruction.replace(/^\[[^\]]+\]\s*/, "");
  const ss = stateStyle(d?.operatingState);
  const isLoto = d?.isLotoTransition;

  return (
    <li
      className="rounded-xl border bg-[var(--color-surface)] overflow-hidden"
      style={{ borderColor: isLoto ? "rgba(239,68,68,0.4)" : "var(--color-border)" }}
    >
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start gap-3 p-3 text-left hover:bg-[var(--color-surface-2)]/40">
        <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--color-surface-2)] grid place-items-center text-[11px] text-[var(--color-muted)] mt-0.5">{index}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {d?.operatingState && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: ss.color, background: ss.bg }}>
                {d.operatingState}
              </span>
            )}
            {d?.skillLevel && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{d.skillLevel}</span>
            )}
            {typeof d?.estMinutes === "number" && d.estMinutes > 0 && (
              <span className="text-[10px] text-[var(--color-faint)]">~{d.estMinutes} min</span>
            )}
          </div>
          <div className="text-[13px] font-medium mt-1 leading-snug">{title}</div>
          {d?.purpose && !open && <div className="text-[12px] text-[var(--color-faint)] mt-0.5 line-clamp-1">{d.purpose}</div>}
        </div>
        {d && <span className="text-[var(--color-faint)] text-sm shrink-0">{open ? "−" : "+"}</span>}
      </button>

      {open && d && (
        <div className="px-3 pb-3 pl-12">
          {d.purpose && <p className="text-[12px] text-[var(--color-muted)] leading-relaxed"><span className="text-[var(--color-faint)]">Purpose: </span>{d.purpose}</p>}
          <StepList label="Procedure" items={d.procedure} accent="var(--color-accent)" />
          <StepList label="Measurements / readings" items={d.measurements} accent="var(--color-muted)" />
          <StepList label="Acceptance criteria" items={d.acceptanceCriteria} accent="var(--color-green)" />
          {d.outOfSpecAction && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-faint)] mb-1">If out of spec</div>
              <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">{d.outOfSpecAction}</p>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-x-4">
            <StepList label="PPE" items={d.ppe} accent="var(--color-red)" />
            <StepList label="Safety" items={d.safety} accent="var(--color-red)" />
            <StepList label="Tools" items={d.tools} accent="var(--color-amber)" />
            <StepList label="Parts" items={d.parts} accent="var(--color-green)" />
            <StepList label="Common failure modes" items={d.failureModes} accent="var(--color-amber)" />
            <StepList label="References / standards" items={[...(d.oemRefs || []), ...(d.standards || [])]} accent="var(--color-faint)" />
          </div>
        </div>
      )}
    </li>
  );
}
