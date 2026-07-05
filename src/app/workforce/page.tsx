"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";

// Team Skills — the technician skills matrix for the maintenance department:
// who is qualified on what, where coverage is thin, and which skills have a
// single point of failure. This is maintenance-operations tooling (safe work
// assignment and cross-training), NOT a recruiting/ATS feature — candidate
// scoring and hiring briefs were removed from the product scope.
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

export default function TeamSkillsPage() {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTech, setNewTech] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/workforce").then((r) => r.json());
    setMatrix(d.matrix);
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
        title="Team Skills"
        subtitle="Who's qualified on what — coverage and key-person risk for safe work assignment"
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
              <div className="h-[320px] rounded-xl bg-[var(--color-surface-2)]" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Stat label="Technicians" value={matrix?.headcount ?? 0} />
                <Stat label="Skills tracked" value={matrix?.skills.length ?? 0} />
                <Stat label="Coverage gaps" value={critical} color="var(--color-red)" />
                <Stat label="Key-person risks" value={warning} color="var(--color-amber)" />
              </div>

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
                    Add your technicians and rate each skill 0–5. EAS shows coverage
                    per skill and flags single-points-of-failure so you can plan
                    cross-training before it bites.
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
                Use gaps to plan cross-training and safe work assignment.
              </p>
            </>
          )}
        </div>
      </div>
    </>
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
