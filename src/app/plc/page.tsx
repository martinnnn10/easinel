"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";

interface ProjectRow {
  id: string;
  filename: string;
  source: string;
  fidelity: string;
  controllerName: string | null;
  processorType: string | null;
  programCount: number;
  routineCount: number;
  tagCount: number;
  aoiCount: number;
  udtCount: number;
}

export default function PlcListPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);

  useEffect(() => {
    fetch("/api/plc")
      .then((r) => r.json())
      .then((j) => setProjects(j.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="PLC Explorer"
        subtitle="Browse Rockwell / Studio 5000 projects without owning the software"
      />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {projects === null ? (
          <div className="max-w-4xl grid gap-3 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[104px] rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-4xl grid gap-3">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => router.push(`/plc/${p.id}`)}
                className="text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)] transition-colors group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold truncate group-hover:text-[var(--color-accent)]">
                        {p.controllerName || p.filename}
                      </span>
                      <FidelityBadge source={p.source} fidelity={p.fidelity} />
                    </div>
                    <div className="text-[11.5px] text-[var(--color-faint)] mt-0.5 truncate">
                      {p.filename}
                      {p.processorType ? ` · ${p.processorType}` : ""}
                    </div>
                  </div>
                  <span className="text-[var(--color-faint)] group-hover:text-[var(--color-accent)] shrink-0">→</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11.5px] text-[var(--color-muted)]">
                  <Stat n={p.programCount} label="programs" />
                  <Stat n={p.routineCount} label="routines" />
                  <Stat n={p.tagCount} label="tags" />
                  <Stat n={p.aoiCount} label="AOIs" />
                  <Stat n={p.udtCount} label="UDTs" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-semibold text-[var(--color-text)]">{n}</span> {label}
    </span>
  );
}

function FidelityBadge({ source, fidelity }: { source: string; fidelity: string }) {
  const full = fidelity === "full";
  return (
    <span
      className={`text-[9.5px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
        full
          ? "border-[var(--color-green)]/40 text-[var(--color-green)] bg-[rgba(60,200,120,0.08)]"
          : "border-[var(--color-amber)]/40 text-[var(--color-amber)] bg-[rgba(245,165,36,0.08)]"
      }`}
      title={full ? "Full structured detail" : "Summary only — export to .L5X for full detail"}
    >
      {source.toUpperCase()} · {full ? "full" : "summary"}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="max-w-lg rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
      <div className="text-[15px] font-semibold mb-1">No PLC projects yet</div>
      <p className="text-[13px] text-[var(--color-muted)] leading-relaxed">
        Upload a Studio 5000 export from the Copilot home (the <strong>PLC Program</strong> tile) or the
        Knowledge page. A <code className="text-[var(--color-accent)]">.L5X</code> file gives the richest
        exploration — programs, routines, ladder/ST logic, tags, AOIs and UDTs. Native{" "}
        <code className="text-[var(--color-accent)]">.ACD</code> files are supported as summary-only.
      </p>
    </div>
  );
}
