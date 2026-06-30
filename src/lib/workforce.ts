import { db, ensureDb } from "@/lib/db";
import {
  technicians,
  skills,
  technicianSkills,
  type Technician,
} from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";
import { id } from "@/lib/util";

// Default industrial skills taxonomy — seeded on first use so the matrix is
// meaningful immediately. Categories map to the Copilot's domains.
const DEFAULT_SKILLS: { name: string; category: string }[] = [
  { name: "Electrical Troubleshooting", category: "electrical" },
  { name: "PLC Programming (Allen-Bradley)", category: "controls" },
  { name: "PLC Programming (Siemens)", category: "controls" },
  { name: "VFD / Drives", category: "controls" },
  { name: "Servo / Motion", category: "controls" },
  { name: "Hydraulics", category: "mechanical" },
  { name: "Pneumatics", category: "mechanical" },
  { name: "Mechanical / Bearings / Gearboxes", category: "mechanical" },
  { name: "Robotics", category: "controls" },
  { name: "Instrumentation", category: "electrical" },
  { name: "Industrial Networking", category: "controls" },
  { name: "Welding / Fabrication", category: "mechanical" },
  { name: "Ammonia Refrigeration", category: "mechanical" },
  { name: "Vibration Analysis", category: "reliability" },
  { name: "Root Cause Analysis", category: "reliability" },
  { name: "LOTO / Arc Flash Safety", category: "safety" },
];

const TARGET = 3; // proficiency (0–5) considered "qualified" for a skill

export async function ensureSkills(orgId: string): Promise<void> {
  if (!orgId) throw new Error("ensureSkills() requires orgId");
  await ensureDb();
  const existing = await db.select().from(skills).where(eq(skills.orgId, orgId));
  if (existing.length) return;
  for (const s of DEFAULT_SKILLS) {
    await db.insert(skills).values({
      id: id("skl"),
      orgId,
      name: s.name,
      category: s.category,
    });
  }
}

export async function listTechnicians(orgId: string): Promise<Technician[]> {
  if (!orgId) throw new Error("listTechnicians() requires orgId");
  await ensureDb();
  return db
    .select()
    .from(technicians)
    .where(eq(technicians.orgId, orgId))
    .orderBy(desc(technicians.createdAt));
}

export async function createTechnician(
  orgId: string,
  input: {
    name: string;
    role?: string;
    level?: string;
    email?: string;
  }
): Promise<Technician> {
  if (!orgId) throw new Error("createTechnician() requires orgId");
  await ensureDb();
  const tId = id("tec");
  await db.insert(technicians).values({
    id: tId,
    orgId,
    name: input.name,
    role: input.role ?? "technician",
    level: input.level ?? "mid",
    email: input.email ?? null,
  });
  return (
    await db.select().from(technicians).where(and(eq(technicians.orgId, orgId), eq(technicians.id, tId)))
  )[0];
}

export async function setSkill(
  orgId: string,
  technicianId: string,
  skillId: string,
  proficiency: number
): Promise<void> {
  if (!orgId) throw new Error("setSkill() requires orgId");
  await ensureDb();
  const existing = (
    await db
      .select()
      .from(technicianSkills)
      .where(
        and(
          eq(technicianSkills.orgId, orgId),
          eq(technicianSkills.technicianId, technicianId),
          eq(technicianSkills.skillId, skillId)
        )
      )
  )[0];
  if (existing) {
    await db
      .update(technicianSkills)
      .set({ proficiency })
      .where(and(eq(technicianSkills.orgId, orgId), eq(technicianSkills.id, existing.id)));
  } else {
    await db.insert(technicianSkills).values({
      id: id("ts"),
      orgId,
      technicianId,
      skillId,
      proficiency,
    });
  }
}

export interface SkillCoverage {
  skillId: string;
  skill: string;
  category: string;
  qualified: number; // techs at/above target
  maxProficiency: number;
  riskLevel: "critical" | "warning" | "ok";
}

export interface WorkforceMatrix {
  technicians: Technician[];
  skills: { id: string; name: string; category: string }[];
  grid: Record<string, Record<string, number>>; // techId -> skillId -> prof
  coverage: SkillCoverage[];
  gaps: SkillCoverage[];
  headcount: number;
}

export async function buildMatrix(orgId: string): Promise<WorkforceMatrix> {
  if (!orgId) throw new Error("buildMatrix() requires orgId");
  await ensureSkills(orgId);
  const techs = await listTechnicians(orgId);
  const sk = await db.select().from(skills).where(eq(skills.orgId, orgId));
  const ts = await db
    .select()
    .from(technicianSkills)
    .where(eq(technicianSkills.orgId, orgId));

  const grid: Record<string, Record<string, number>> = {};
  for (const t of techs) grid[t.id] = {};
  for (const row of ts) {
    if (!grid[row.technicianId]) grid[row.technicianId] = {};
    grid[row.technicianId][row.skillId] = row.proficiency;
  }

  const coverage: SkillCoverage[] = sk.map((s) => {
    let qualified = 0;
    let maxP = 0;
    for (const t of techs) {
      const p = grid[t.id]?.[s.id] ?? 0;
      if (p >= TARGET) qualified++;
      if (p > maxP) maxP = p;
    }
    const riskLevel: SkillCoverage["riskLevel"] =
      qualified === 0 ? "critical" : qualified === 1 ? "warning" : "ok";
    return {
      skillId: s.id,
      skill: s.name,
      category: s.category ?? "general",
      qualified,
      maxProficiency: maxP,
      riskLevel,
    };
  });

  const gaps = coverage
    .filter((c) => c.riskLevel !== "ok")
    .sort((a, b) => a.qualified - b.qualified || a.skill.localeCompare(b.skill));

  return {
    technicians: techs,
    skills: sk.map((s) => ({ id: s.id, name: s.name, category: s.category ?? "general" })),
    grid,
    coverage,
    gaps,
    headcount: techs.length,
  };
}

export interface CandidateSkill {
  skillId: string;
  proficiency: number; // 0–5
}
export interface CandidateInput {
  name: string;
  skills: CandidateSkill[];
}
export interface CandidateMatch {
  name: string;
  fitScore: number; // 0–100, gap-weighted
  capability: number; // 0–100, overall avg across tracked skills
  closesCritical: string[];
  closesWarning: string[];
  missesCritical: string[];
  qualifiedSkills: number;
  verdict: string;
}

// Score a candidate against the live gap profile. Critical gaps are weighted 3×
// warning gaps, so the score rewards exactly the hires that de-risk the plant.
export function scoreCandidate(
  m: WorkforceMatrix,
  candidate: CandidateInput
): CandidateMatch {
  const prof = new Map(candidate.skills.map((s) => [s.skillId, s.proficiency]));
  const QUAL = 3;

  const critical = m.coverage.filter((c) => c.riskLevel === "critical");
  const warning = m.coverage.filter((c) => c.riskLevel === "warning");

  const closesCritical: string[] = [];
  const missesCritical: string[] = [];
  const closesWarning: string[] = [];

  for (const g of critical) {
    if ((prof.get(g.skillId) ?? 0) >= QUAL) closesCritical.push(g.skill);
    else missesCritical.push(g.skill);
  }
  for (const g of warning) {
    if ((prof.get(g.skillId) ?? 0) >= QUAL) closesWarning.push(g.skill);
  }

  const totalWeight = critical.length * 3 + warning.length * 1;
  const coveredWeight = closesCritical.length * 3 + closesWarning.length * 1;
  const gapFit = totalWeight > 0 ? coveredWeight / totalWeight : null;

  // Overall capability: average proficiency across all tracked skills (0–5 → 0–100).
  let sum = 0;
  let qualifiedSkills = 0;
  for (const s of m.skills) {
    const p = prof.get(s.id) ?? 0;
    sum += p;
    if (p >= QUAL) qualifiedSkills++;
  }
  const capability = m.skills.length
    ? Math.round((sum / (m.skills.length * 5)) * 100)
    : 0;

  // Fit score: when gaps exist, weight gap closure heavily (80/20); otherwise
  // fall back to raw capability.
  const fitScore =
    gapFit === null
      ? capability
      : Math.round(gapFit * 80 + (capability / 100) * 20);

  let verdict: string;
  if (closesCritical.length && missesCritical.length === 0)
    verdict = "Strong hire — closes every critical gap.";
  else if (closesCritical.length)
    verdict = `Good hire — closes ${closesCritical.length} of ${critical.length} critical gaps.`;
  else if (closesWarning.length)
    verdict = "Reduces key-person risk, but leaves critical gaps open.";
  else if (!critical.length && !warning.length)
    verdict = "No open gaps — evaluate on capability and growth.";
  else verdict = "Weak fit for current gaps — keep sourcing.";

  return {
    name: candidate.name,
    fitScore,
    capability,
    closesCritical,
    closesWarning,
    missesCritical,
    qualifiedSkills,
    verdict,
  };
}

// Build a hiring brief from the current gaps — the artifact pushed to an ATS.
export function buildHiringBrief(m: WorkforceMatrix): string {
  if (!m.headcount) {
    return "Add technicians and rate their skills to generate a data-driven hiring brief and skill-gap analysis.";
  }
  const critical = m.gaps.filter((g) => g.riskLevel === "critical");
  const single = m.gaps.filter((g) => g.riskLevel === "warning");

  const lines: string[] = [];
  lines.push(`## Workforce Skill-Gap Analysis`);
  lines.push(
    `Headcount: **${m.headcount}** · Skills tracked: **${m.skills.length}** · ` +
      `Critical gaps: **${critical.length}** · Single-point-of-failure skills: **${single.length}**`
  );

  if (critical.length) {
    lines.push(`\n## 🔴 Critical Gaps (no qualified technician)`);
    lines.push(`| Skill | Category | Coverage |\n|---|---|---|`);
    for (const g of critical)
      lines.push(`| ${g.skill} | ${g.category} | 0 qualified |`);
  }
  if (single.length) {
    lines.push(`\n## 🟡 Key-Person Risk (only one qualified)`);
    lines.push(`| Skill | Category | Coverage |\n|---|---|---|`);
    for (const g of single)
      lines.push(`| ${g.skill} | ${g.category} | 1 qualified |`);
  }

  lines.push(`\n## Recommended Hire — Ideal Candidate Profile`);
  const mustHave = critical.slice(0, 5).map((g) => g.skill);
  const niceToHave = single.slice(0, 4).map((g) => g.skill);
  lines.push(
    `Target a **multi-craft maintenance technician / controls technician** who closes the critical gaps first.`
  );
  if (mustHave.length) lines.push(`\n**Must-have skills:**\n- ${mustHave.join("\n- ")}`);
  if (niceToHave.length)
    lines.push(`\n**Strongly preferred (reduce key-person risk):**\n- ${niceToHave.join("\n- ")}`);
  lines.push(
    `\n## Next Action\nPush this profile to your ATS (Greenhouse / Lever / Workday) as a new req, or use it to prioritize internal upskilling for the single-coverage skills.`
  );
  return lines.join("\n");
}
