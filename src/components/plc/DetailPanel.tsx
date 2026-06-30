"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";

export interface NodeDetail {
  found: boolean;
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  data: Record<string, unknown>;
  breadcrumb: { id: string; label: string }[];
  notice?: string;
}

export function DetailPanel({
  projectId,
  detail,
  loading,
  onNavigate,
}: {
  projectId: string;
  detail: NodeDetail | null;
  loading: boolean;
  onNavigate: (nodeId: string) => void;
}) {
  if (loading) {
    return <Centered><Spinner /> <span className="ml-2 text-[13px] text-[var(--color-muted)]">Loading…</span></Centered>;
  }
  if (!detail) {
    return (
      <Centered>
        <div className="text-center max-w-sm">
          <div className="text-[13px] text-[var(--color-muted)]">
            Select any element in the tree to inspect it — programs, routines, tags, Add-On Instructions, UDTs and I/O modules are all explorable.
          </div>
        </div>
      </Centered>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-5 max-w-3xl">
        <Header detail={detail} />
        {detail.notice && <Notice text={detail.notice} />}
        {detail.found && <Body detail={detail} onNavigate={onNavigate} />}
        {(detail.found || detail.type === "routine" || detail.type === "tag") && (
          <AiExplain projectId={projectId} detail={detail} />
        )}
      </div>
    </div>
  );
}

function Header({ detail }: { detail: NodeDetail }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <TypeBadge type={detail.type} />
        <h2 className="text-[17px] font-semibold tracking-tight truncate">{detail.title}</h2>
      </div>
      {detail.subtitle && <div className="text-[12px] text-[var(--color-muted)]">{detail.subtitle}</div>}
    </div>
  );
}

function Body({ detail, onNavigate }: { detail: NodeDetail; onNavigate: (id: string) => void }) {
  switch (detail.type) {
    case "controller":
      return <ControllerView d={detail.data} />;
    case "task":
      return <TaskView d={detail.data} onNavigate={onNavigate} />;
    case "program":
      return <ProgramView d={detail.data} onNavigate={onNavigate} />;
    case "routine":
      return <RoutineView d={detail.data} onNavigate={onNavigate} />;
    case "tag":
      return <TagView d={detail.data} onNavigate={onNavigate} />;
    case "aoi":
      return <AoiView d={detail.data} onNavigate={onNavigate} />;
    case "udt":
      return <UdtView d={detail.data} />;
    case "module":
      return <ModuleView d={detail.data} />;
    default:
      return null;
  }
}

// ───────────────────────── per-type views ─────────────────────────

function ControllerView({ d }: { d: Record<string, unknown> }) {
  const s = (d.stats as Record<string, number>) ?? {};
  return (
    <>
      <Fields
        rows={[
          ["Processor", str(d.processorType)],
          ["Revision", str(d.revision)],
          ["Software", str(d.softwareRevision)],
          ["Export date", str(d.exportDate)],
          ["Description", str(d.description)],
        ]}
      />
      <SectionTitle>Project contents</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Programs", s.programs],
          ["Routines", s.routines],
          ["Tags", s.tags],
          ["AOIs", s.aois],
          ["UDTs", s.udts],
          ["I/O Modules", s.modules],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="text-[20px] font-semibold">{Number(v ?? 0)}</div>
            <div className="text-[11px] text-[var(--color-faint)] uppercase tracking-wide">{String(k)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function TaskView({ d, onNavigate }: { d: Record<string, unknown>; onNavigate: (id: string) => void }) {
  const programs = (d.programs as string[]) ?? [];
  return (
    <>
      <Fields
        rows={[
          ["Type", str(d.type)],
          ["Rate", str(d.rate)],
          ["Priority", str(d.priority)],
        ]}
      />
      <SectionTitle>Scheduled programs</SectionTitle>
      <Chips items={programs.map((p) => ({ label: p, onClick: () => onNavigate(`program:${p}`) }))} empty="No programs scheduled by this task." />
    </>
  );
}

function ProgramView({ d, onNavigate }: { d: Record<string, unknown>; onNavigate: (id: string) => void }) {
  const routines = (d.routines as { name: string; type: string; rungs: number; isMain: boolean }[]) ?? [];
  const tags = (d.tags as { name: string; dataType: string }[]) ?? [];
  const called = (d.calledRoutines as string[]) ?? [];
  const progName = str(d.mainRoutine) !== "—" ? "" : "";
  void progName;
  return (
    <>
      <Fields
        rows={[
          ["Description", str(d.description)],
          ["Main routine", str(d.mainRoutine)],
          ["Scheduled by", str(d.task)],
        ]}
      />
      <SectionTitle>Routines ({routines.length})</SectionTitle>
      <Table
        head={["Routine", "Type", "Rungs"]}
        rows={routines.map((r) => [
          <LinkCell key={r.name} onClick={() => onNavigate(routineId(r.name, d))}>
            {r.name}
            {r.isMain && <Pill>main</Pill>}
          </LinkCell>,
          r.type,
          String(r.rungs),
        ])}
        empty="No routines in this program."
      />
      {called.length > 0 && (
        <>
          <SectionTitle>Called routines</SectionTitle>
          <Chips items={called.map((c) => ({ label: c, onClick: () => onNavigate(routineId(c, d)) }))} />
        </>
      )}
      <SectionTitle>Program tags ({tags.length})</SectionTitle>
      <Chips
        items={tags.map((t) => ({
          label: `${t.name} : ${t.dataType}`,
          onClick: () => onNavigate(`tag:program/${progFromBreadcrumb(d)}/${t.name}`),
        }))}
        empty="No program-scoped tags."
      />
    </>
  );
}

function RoutineView({ d, onNavigate }: { d: Record<string, unknown>; onNavigate: (id: string) => void }) {
  const rungs = (d.rungs as { number: number; text: string; comment?: string; tags: string[] }[] | null) ?? null;
  const stLines = (d.stLines as string[] | null) ?? null;
  const refs = (d.referencedTags as string[]) ?? [];
  const calls = (d.calledRoutines as string[]) ?? [];
  const program = str(d.program);
  return (
    <>
      <Fields rows={[["Program", program], ["Type", str(d.routineType)], ["Description", str(d.description)]]} />

      {rungs && rungs.length > 0 && (
        <>
          <SectionTitle>Ladder logic ({rungs.length} rungs)</SectionTitle>
          <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
            {rungs.map((r) => (
              <div key={r.number} className="border-b border-[var(--color-border-soft)] last:border-0">
                {r.comment && <div className="px-3 pt-2 text-[11px] text-[var(--color-green)] italic">// {r.comment}</div>}
                <div className="flex gap-3 px-3 py-1.5">
                  <span className="text-[11px] text-[var(--color-faint)] font-mono w-7 shrink-0 text-right pt-0.5">{r.number}</span>
                  <code className="text-[12px] font-mono text-[var(--color-text)] break-all">{r.text || "—"}</code>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {stLines && stLines.length > 0 && (
        <>
          <SectionTitle>Structured Text ({stLines.length} lines)</SectionTitle>
          <pre className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 overflow-x-auto text-[12px] font-mono leading-relaxed">
            {stLines.map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-[var(--color-faint)] w-7 shrink-0 text-right select-none">{i + 1}</span>
                <span className="break-all">{l}</span>
              </div>
            ))}
          </pre>
        </>
      )}

      <SectionTitle>Referenced tags ({refs.length})</SectionTitle>
      <Chips
        items={refs.map((t) => ({ label: t, onClick: () => onNavigate(`tag:program/${program}/${baseTag(t)}`) }))}
        empty="No tag references parsed for this routine."
      />

      {calls.length > 0 && (
        <>
          <SectionTitle>Cross reference — calls</SectionTitle>
          <Chips items={calls.map((c) => ({ label: c, onClick: () => onNavigate(`routine:${program}/${c}`) }))} />
        </>
      )}
    </>
  );
}

function TagView({ d, onNavigate }: { d: Record<string, unknown>; onNavigate: (id: string) => void }) {
  const usage = (d.usage as { program?: string; routine: string; locations: number[]; access?: string }[]) ?? [];
  return (
    <>
      <Fields
        rows={[
          ["Data type", str(d.dataType)],
          ["Scope", str(d.scope)],
          ["Program", str(d.program)],
          ["Alias for", d.alias ? String(d.alias) : "—"],
          ["Dimensions", d.dimensions ? String(d.dimensions) : "—"],
          ["Radix", str(d.radix)],
          ["External access", str(d.externalAccess)],
          ["Constant", d.constant ? "Yes" : "No"],
          ["Value", d.value != null ? String(d.value) : "—"],
          ["Description", str(d.description)],
        ]}
      />
      <SectionTitle>Read / write locations ({Number(d.usageCount ?? 0)})</SectionTitle>
      <Table
        head={["Routine", "Program", "Locations"]}
        rows={usage.map((u) => [
          <LinkCell key={u.routine} onClick={() => onNavigate(`routine:${u.program ?? str(d.program)}/${u.routine}`)}>
            {u.routine}
          </LinkCell>,
          u.program ?? "—",
          u.locations.join(", "),
        ])}
        empty="No cross references found in this export (the tag may be driven by an HMI, message instruction, or a routine that wasn't included)."
      />
    </>
  );
}

function AoiView({ d, onNavigate }: { d: Record<string, unknown>; onNavigate: (id: string) => void }) {
  const params = (d.parameters as { name: string; dataType: string; usage: string; required?: boolean; description?: string }[]) ?? [];
  const routines = (d.routines as { name: string; type: string; rungs: number }[]) ?? [];
  const local = (d.localTags as { name: string; dataType: string }[]) ?? [];
  const usage = (d.usage as { program?: string; routine: string; locations: number[] }[]) ?? [];
  return (
    <>
      <Fields rows={[["Revision", str(d.revision)], ["Description", str(d.description)]]} />
      <SectionTitle>Parameters ({params.length})</SectionTitle>
      <Table
        head={["Name", "Usage", "Type", "Req", "Description"]}
        rows={params.map((p) => [p.name, <Pill key={p.name}>{p.usage}</Pill>, p.dataType, p.required ? "Yes" : "—", p.description ?? "—"])}
        empty="No parameters defined."
      />
      <SectionTitle>Internal logic</SectionTitle>
      <Table
        head={["Routine", "Type", "Rungs"]}
        rows={routines.map((r) => [
          <LinkCell key={r.name} onClick={() => onNavigate(`routine:${aoiName(d)}/${r.name}`)}>{r.name}</LinkCell>,
          r.type,
          String(r.rungs),
        ])}
        empty="No internal routines exported."
      />
      {local.length > 0 && (
        <>
          <SectionTitle>Local tags</SectionTitle>
          <Chips items={local.map((t) => ({ label: `${t.name} : ${t.dataType}` }))} />
        </>
      )}
      <SectionTitle>Usage locations ({Number(d.usageCount ?? 0)})</SectionTitle>
      <Table
        head={["Routine", "Program", "Locations"]}
        rows={usage.map((u) => [
          <LinkCell key={u.routine} onClick={() => onNavigate(`routine:${u.program ?? ""}/${u.routine}`)}>{u.routine}</LinkCell>,
          u.program ?? "—",
          u.locations.join(", "),
        ])}
        empty="This AOI isn't instantiated in any parsed routine."
      />
    </>
  );
}

function UdtView({ d }: { d: Record<string, unknown> }) {
  const members = (d.members as { name: string; dataType: string; dimension?: string; description?: string }[]) ?? [];
  const usedBy = (d.usedBy as string[]) ?? [];
  return (
    <>
      <Fields rows={[["Description", str(d.description)]]} />
      <SectionTitle>Members ({members.length})</SectionTitle>
      <Table
        head={["Member", "Data type", "Dim", "Description"]}
        rows={members.map((m) => [m.name, m.dataType, m.dimension ?? "—", m.description ?? "—"])}
        empty="No members defined."
      />
      <SectionTitle>Where it is used ({usedBy.length})</SectionTitle>
      <Chips items={usedBy.map((u) => ({ label: u }))} empty="No references found in this export." />
    </>
  );
}

function ModuleView({ d }: { d: Record<string, unknown> }) {
  return (
    <Fields
      rows={[
        ["Catalog number", str(d.catalogNumber)],
        ["Vendor", str(d.vendor)],
        ["Product type", str(d.productType)],
        ["Parent module", str(d.parentModule)],
        ["Slot / port", str(d.slot)],
        ["Description", str(d.description)],
      ]}
    />
  );
}

// ───────────────────────── AI explanation ─────────────────────────

function AiExplain({ projectId, detail }: { projectId: string; detail: NodeDetail }) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const askable = detail.type === "routine" || detail.type === "tag" || detail.type === "aoi";
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (q?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plc/${projectId}/explain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: detail.id, question: q }),
      });
      const json = await res.json();
      setText(json.explanation ?? json.error ?? "No explanation available.");
      setLive(Boolean(json.live));
    } catch (e) {
      setText(`Could not generate an explanation: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Reset when the node changes.
  useEffect(() => {
    setText("");
    setLive(null);
    setQuestion("");
  }, [detail.id]);

  return (
    <div className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/40">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <BrainIcon className="w-4 h-4 text-[var(--color-accent)]" />
          AI explanation
          {live === false && <span className="text-[10px] text-[var(--color-faint)] font-normal">· grounded engine</span>}
          {live === true && <span className="text-[10px] text-[var(--color-green)] font-normal">· live model</span>}
        </div>
        {!text && !loading && (
          <button
            onClick={() => run()}
            className="text-[11.5px] font-medium px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
          >
            Explain in plain English
          </button>
        )}
      </div>
      <div className="px-4 py-3">
        {loading && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
            <Spinner /> Thinking…
          </div>
        )}
        {!loading && text && <Markdown>{text}</Markdown>}
        {!loading && !text && (
          <div className="text-[12.5px] text-[var(--color-muted)]">
            Get a plain-English explanation of this {detail.type} — what it does and what to watch for when troubleshooting.
          </div>
        )}

        {askable && (
          <div className="mt-3 flex gap-2">
            <input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) run(question.trim());
              }}
              placeholder={`Ask AI about this ${detail.type}…`}
              className="flex-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => question.trim() && run(question.trim())}
              disabled={!question.trim() || loading}
              className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[12.5px] font-medium hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── shared bits ─────────────────────────

function Notice({ text }: { text: string }) {
  return (
    <div className="mb-4 flex gap-2.5 rounded-lg border border-[var(--color-amber)]/40 bg-[rgba(245,165,36,0.08)] px-3.5 py-3 text-[12.5px] text-[#f1d9a8] leading-relaxed">
      <InfoIcon className="w-4 h-4 shrink-0 mt-0.5 text-[var(--color-amber)]" />
      <span>{text}</span>
    </div>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-1.5 text-[13px] mb-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--color-faint)] py-1">{k}</dt>
          <dd className="text-[var(--color-text)] py-1 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)] mt-5 mb-2">{children}</h3>;
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <Empty text={empty ?? "Nothing to show."} />;
  return (
    <div className="rounded-lg border border-[var(--color-border)] overflow-hidden overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-[var(--color-surface-2)]">
            {head.map((h) => (
              <th key={h} className="text-left font-semibold text-[10.5px] uppercase tracking-wide text-[var(--color-faint)] px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-[var(--color-border-soft)]">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chips({ items, empty }: { items: { label: string; onClick?: () => void }[]; empty?: string }) {
  if (!items.length) return <Empty text={empty ?? "None."} />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <button
          key={i}
          onClick={it.onClick}
          disabled={!it.onClick}
          className={`text-[12px] font-mono px-2 py-1 rounded-md border border-[var(--color-border)] ${
            it.onClick ? "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] cursor-pointer" : "cursor-default"
          } bg-[var(--color-surface)] text-[var(--color-muted)]`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function LinkCell({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-[var(--color-accent)] hover:underline font-medium">
      {children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 text-[9.5px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-accent-soft)] text-[#bcd4f5] align-middle">{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="text-[12.5px] text-[var(--color-faint)] italic rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5">{text}</div>;
}

function TypeBadge({ type }: { type: string }) {
  const label = type.toUpperCase();
  return (
    <span className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)]">
      {label}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full grid place-items-center px-6">{children}</div>;
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin align-[-2px]" />;
}

// helpers to derive ids from the program/aoi context in `data`
function str(v: unknown): string {
  return v == null || v === "" ? "—" : String(v);
}
function baseTag(t: string): string {
  return t.split(/[.[]/)[0];
}
function routineId(routine: string, d: Record<string, unknown>): string {
  return `routine:${progFromBreadcrumb(d)}/${routine}`;
}
function progFromBreadcrumb(d: Record<string, unknown>): string {
  // ProgramView passes the program name implicitly via the resolved node's
  // title; we stash it on data.__program when available, else fall back.
  return (d.__program as string) ?? (d.mainRoutineProgram as string) ?? (d.program as string) ?? "";
}
function aoiName(d: Record<string, unknown>): string {
  return (d.__aoi as string) ?? "";
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 7 17a3 3 0 0 0 5 1 3 3 0 0 0 5-1 3 3 0 0 0 2-5.2A3 3 0 0 0 18 6a3 3 0 0 0-3-3 3 3 0 0 0-3 1.5A3 3 0 0 0 9 3z" />
    </svg>
  );
}
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v4h1" />
    </svg>
  );
}
