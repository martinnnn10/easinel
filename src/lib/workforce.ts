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

