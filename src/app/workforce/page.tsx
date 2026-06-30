"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { Markdown } from "@/components/Markdown";

interface Tech {
  id: string;
  name: string;
  role?: string;
  level?: string;
}
interface SkillRow {
  id: string;
  name: string;
  category: string;
}
interface Coverage {
  skillId: string;
  skill: string;
  qualified: number;
  riskLevel: "critical" | "warning" | "ok";
}
interface Matrix {
  technicians: Tech[];
  skills: SkillRow[];
  grid: Record<string, Record<string, number>>;
  coverage: Coverage[];
  gaps: Coverage[];
  headcount: number;
}

const riskColor: Record<string, string> = {
  critical: "var(--color-red)",
  warning: "var(--color-amber)",
  ok: "var(--color-green)",
};

export default function WorkforcePage() {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(true);
  const [newTech, setNewTech] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/workforce").then((r) => r.json());
    setMatrix(d.matrix);
    setBrief(d.brief ?? "");
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const addTech = async () => {
    if (!newTech.trim()) return;
    await fetch("/api/workforce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_technician", name: newTech }),
    });
    setNewTech("");
    load();
  };

  const setSkill = async (technicianId: string, skillId: string, proficiency: number) => {
    await fetch("/api/workforce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_skill", technicianId, skillId, proficiency }),
    });
    load();
  };

  const critical = matrix?.gaps.filter((g) => g.riskLevel === "critical").length ?? 0;
  const warning = matrix?.gaps.filter((g) => g.riskLevel === "warning").length ?? 0;

  return (
    <>
      <TopBar
        title="Workforce Intelligence"
        subtitle="Skills matrix, gap analysis & data-driven hiring briefs"
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-5 py-6">
          {loading ? (
            <div className="animate-pulse">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-[76px] rounded-xl bg-[var(--color-surface-2)]" />
                ))}
              </div>
              <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 h-[320px] rounded-xl bg-[var(--color-surface-2)]" />
                <div className="h-[320px] rounded-xl bg-[var(--color-surface-2)]" />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Stat label="Technicians" value={matrix?.headcount ?? 0} />
                <Stat label="Skills tracked" value={matrix?.skills.length ?? 0} />
                <Stat label="Critical gaps" value={critical} color="var(--color-red)" />
                <Stat label="Key-person risks" value={warning} color="var(--color-amber)" />
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                {/* Matrix */}
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-[14px]">Skills Matrix</h3>
                    <div className="flex gap-2">
                      <input
                        value={newTech}
                        onChange={(e) => setNewTech(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addTech()}
                        placeholder="Add technician…"
                        className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]"
                      />
                      <button
                        onClick={addTech}
                        className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {matrix && matrix.headcount === 0 ? (
                    <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl">
                      <p className="text-[14px] font-medium">Build your skills matrix</p>
                      <p className="text-[var(--color-muted)] text-[13px] mt-1 max-w-sm mx-auto">
                        Add your technicians and rate each skill 0–5. EAS computes
                        coverage, flags single-points-of-failure, and drafts the
                        hire that closes the gap.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[var(--color-border)] rounded-xl">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="bg-[var(--color-surface-2)]">
                            <th className="text-left px-3 py-2 font-medium text-[var(--color-muted)] sticky left-0 bg-[var(--color-surface-2)]">
                              Skill
                            </th>
                            <th className="px-2 py-2 text-[var(--color-muted)]">Cov.</th>
                            {matrix?.technicians.map((t) => (
                              <th key={t.id} className="px-2 py-2 font-medium whitespace-nowrap">
                                {t.name.split(" ")[0]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {matrix?.skills.map((s) => {
                            const cov = matrix.coverage.find((c) => c.skillId === s.id);
                            return (
                              <tr key={s.id} className="border-t border-[var(--color-border-soft)]">
                                <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-[var(--color-surface)]">
                                  {s.name}
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{ background: riskColor[cov?.riskLevel ?? "ok"] }}
                                    title={`${cov?.qualified ?? 0} qualified`}
                                  />
                                </td>
                                {matrix.technicians.map((t) => {
                                  const val = matrix.grid[t.id]?.[s.id] ?? 0;
                                  return (
                                    <td key={t.id} className="px-1 py-1 text-center">
                                      <select
                                        value={val}
                                        onChange={(e) => setSkill(t.id, s.id, Number(e.target.value))}
                                        className="bg-transparent text-center outline-none cursor-pointer rounded"
                                        style={{
                                          color:
                                            val >= 3
                                              ? "var(--color-green)"
                                              : val > 0
                                              ? "var(--color-amber)"
                                              : "var(--color-faint)",
                                        }}
                                      >
                                        {[0, 1, 2, 3, 4, 5].map((n) => (
                                          <option key={n} value={n}>
                                            {n}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-[11px] text-[var(--color-faint)] mt-2">
                    0 = none · 3+ = qualified. 🔴 no qualified tech · 🟡 only one (key-person risk).
                  </p>
                </div>

                {/* Hiring brief */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-[14px]">Hiring Brief</h3>
                    <button
                      disabled={!brief.trim()}
                      onClick={() => {
                        const blob = new Blob([brief], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "hiring-brief.md";
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="text-[11px] rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50 disabled:opacity-40"
                    >
                      Export brief
                    </button>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 max-h-[560px] overflow-y-auto">
                    <Markdown>{brief}</Markdown>
                  </div>
                </div>
              </div>

              {matrix && matrix.skills.length > 0 && (
                <CandidateMatch skills={matrix.skills} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface MatchResult {
  name: string;
  fitScore: number;
  capability: number;
  closesCritical: string[];
  closesWarning: string[];
  missesCritical: string[];
  qualifiedSkills: number;
  verdict: string;
}

function CandidateMatch({ skills }: { skills: SkillRow[] }) {
  const [name, setName] = useState("");
  const [prof, setProf] = useState<Record<string, number>>({});
  const [result, setResult] = useState<MatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState(false);

  const score = async () => {
    setBusy(true);
    setPushed(false);
    const skillsArr = Object.entries(prof)
      .filter(([, v]) => v > 0)
      .map(([skillId, proficiency]) => ({ skillId, proficiency }));
    const d = await fetch("/api/workforce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "score_candidate", name: name || "Candidate", skills: skillsArr }),
    }).then((r) => r.json());
    setResult(d.match);
    setBusy(false);
  };

  const gaugeColor =
    !result ? "var(--color-faint)" : result.fitScore >= 70 ? "var(--color-green)" : result.fitScore >= 40 ? "var(--color-amber)" : "var(--color-red)";

  return (
    <div className="mt-8">
      <h3 className="font-semibold text-[14px] mb-1">Candidate Match</h3>
      <p className="text-[12px] text-[var(--color-muted)] mb-3">
        Score a candidate against your <em>actual</em> gaps. Critical gaps are weighted 3× — the score rewards the hire that de-risks the plant.
      </p>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Candidate name"
            className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] mb-3"
          />
          <p className="text-[11px] text-[var(--color-muted)] mb-2">Rate the candidate's skills (0–5):</p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 max-h-[280px] overflow-y-auto">
            {skills.map((s) => (
              <label key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate">{s.name}</span>
                <select
                  value={prof[s.id] ?? 0}
                  onChange={(e) => setProf({ ...prof, [s.id]: Number(e.target.value) })}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-1.5 py-0.5 outline-none"
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            onClick={score}
            disabled={busy}
            className="mt-3 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Scoring…" : "Score candidate"}
          </button>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          {!result ? (
            <p className="text-[13px] text-[var(--color-faint)]">
              Rate the candidate and score to see fit, gap closure, and an
              exportable evaluation summary.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div
                  className="w-20 h-20 rounded-full grid place-items-center shrink-0"
                  style={{ background: `conic-gradient(${gaugeColor} ${result.fitScore * 3.6}deg, var(--color-surface-2) 0deg)` }}
                >
                  <div className="w-[60px] h-[60px] rounded-full bg-[var(--color-surface)] grid place-items-center">
                    <span className="text-xl font-semibold" style={{ color: gaugeColor }}>{result.fitScore}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{result.name}</p>
                  <p className="text-[12px] text-[var(--color-muted)] mt-0.5">{result.verdict}</p>
                  <p className="text-[11px] text-[var(--color-faint)] mt-1">Capability {result.capability}% · {result.qualifiedSkills} skills qualified</p>
                </div>
              </div>

              {result.closesCritical.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] text-[var(--color-green)] uppercase tracking-wide mb-1">Closes critical gaps</p>
                  <div className="flex flex-wrap gap-1">
                    {result.closesCritical.map((s) => (
                      <span key={s} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-green)]/10 text-[var(--color-green)]">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {result.missesCritical.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] text-[var(--color-red)] uppercase tracking-wide mb-1">Still open</p>
                  <div className="flex flex-wrap gap-1">
                    {result.missesCritical.map((s) => (
                      <span key={s} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-red)]/10 text-[var(--color-red)]">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  const lines = [
                    `# Candidate evaluation — ${result.name}`,
                    ``,
                    `Fit score: ${result.fitScore}/100`,
                    `Capability: ${result.capability}%`,
                    `Qualified skills: ${result.qualifiedSkills}`,
                    `Verdict: ${result.verdict}`,
                    ``,
                    `## Closes critical gaps`,
                    result.closesCritical.length ? result.closesCritical.map((s) => `- ${s}`).join("\n") : "- none",
                    ``,
                    `## Still open after this hire`,
                    result.missesCritical.length ? result.missesCritical.map((s) => `- ${s}`).join("\n") : "- none",
                  ].join("\n");
                  const blob = new Blob([lines], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `candidate-${result.name.replace(/\s+/g, "-").toLowerCase()}.md`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setPushed(true);
                }}
                className="mt-4 w-full text-[12px] font-medium rounded-lg border border-[var(--color-border)] py-1.5 hover:border-[var(--color-accent)]/50"
              >
                {pushed ? "✓ Evaluation exported" : "Export evaluation"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-2xl font-semibold" style={{ color: color ?? "var(--color-text)" }}>
        {value}
      </div>
      <div className="text-[12px] text-[var(--color-muted)] mt-0.5">{label}</div>
    </div>
  );
}
