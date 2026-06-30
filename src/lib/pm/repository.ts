// ─────────────────────────────────────────────────────────────────────────
// PM Program repository — the single isolation point for preventive-maintenance
// data access. PMs are the OUTPUT of the maintenance loop: a corrective repair
// closes → a lesson is learned → the AI proposes a PM (draft) → a human APPROVES
// it (active) → it generates due work over time.
//
// Hard rule (Decision: human-in-the-loop): a PM is NEVER auto-activated. AI can
// only create `draft` programs; activation requires approveProgram() with an
// actor. Enforced here and at the API layer (manage_pm permission).
//
// Tenancy: every function REQUIRES orgId as its first parameter, and every
// read/write — including child tables (tasks, evidence, schedules, completions)
// and join lookups — is filtered by orgId. No shared/default fallback.
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import {
  pmPrograms,
  pmTasks,
  pmSchedules,
  pmCompletions,
  pmSourceEvidence,
  assets,
  type PmProgram,
} from "@/lib/db/schema";
import { and, desc, eq, lte } from "drizzle-orm";
import { id } from "@/lib/util";
import { emitEvent, audit } from "@/lib/events";

const DAY = 86_400_000;

// Parse a stored JSON detail blob defensively; never throw on a malformed row.
function safeJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export interface PmEvidence {
  kind: "work_order" | "lesson" | "manual" | "pm_history" | "oem" | "model";
  refId?: string | null;
  detail?: string | null;
}

// A task may be a plain string (legacy: title only) OR a structured object with
// a `title` and a JSON-serializable `detail` (the rich procedure structure).
export type NewPmTask = string | { title: string; detail?: unknown };

export interface NewPmProgram {
  assetId?: string | null;
  title: string;
  failureMode?: string | null;
  frequencyLabel?: string | null;
  intervalDays?: number | null;
  estLaborMins?: number | null;
  tools?: string[];
  parts?: string[];
  safety?: string[];
  reasoning?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  source?: "ai_suggested" | "manual";
  sourceWorkOrderId?: string | null;
  createdBy?: string | null;
  tasks?: NewPmTask[];
  evidence?: PmEvidence[];
}

export interface PmProgramDetail extends PmProgram {
  tasks: { id: string; ordinal: number; instruction: string; detail: unknown | null }[];
  evidence: { kind: string; refId: string | null; detail: string | null }[];
  schedule: { intervalDays: number; nextDueAt: number | null; active: boolean } | null;
  completions: { id: string; status: string; completedAt: number; notes: string | null }[];
  assetName: string | null;
}

// Create a PM program. Always starts as `draft` (approval-gated).
export async function createProgram(
  orgId: string,
  input: NewPmProgram,
  actor = "system"
): Promise<PmProgram> {
  if (!orgId) throw new Error("createProgram() requires orgId");
  // Asset-first rule (no exceptions): a PM is always preventive maintenance OF a
  // machine. It must belong to an asset/component/system. Orphan PMs ("Annual PM
  // · Unassigned") are not allowed — the caller must resolve or create the asset
  // first. Enforced HERE, at the single PM data-access point, so every code path
  // (generation, manual create, work-order suggestion) is held to the same rule.
  if (!input.assetId) {
    throw new Error(
      "A PM program must belong to an asset. Identify, scan, or create the machine first — orphan PMs are not allowed."
    );
  }
  await ensureDb();
  const pmId = id("pm");
  await db.insert(pmPrograms).values({
    id: pmId,
    orgId,
    assetId: input.assetId ?? null,
    title: input.title,
    failureMode: input.failureMode ?? null,
    frequencyLabel: input.frequencyLabel ?? null,
    intervalDays: input.intervalDays ?? null,
    status: "draft",
    estLaborMins: input.estLaborMins ?? null,
    tools: input.tools ? JSON.stringify(input.tools) : null,
    parts: input.parts ? JSON.stringify(input.parts) : null,
    safety: input.safety ? JSON.stringify(input.safety) : null,
    reasoning: input.reasoning ?? null,
    confidence: input.confidence ?? null,
    source: input.source ?? "manual",
    sourceWorkOrderId: input.sourceWorkOrderId ?? null,
    createdBy: input.createdBy ?? actor,
  });

  for (let i = 0; i < (input.tasks ?? []).length; i++) {
    const t = input.tasks![i];
    const instruction = typeof t === "string" ? t : t.title;
    const detail = typeof t === "string" ? null : t.detail ?? null;
    await db.insert(pmTasks).values({
      id: id("pmt"),
      orgId,
      pmProgramId: pmId,
      ordinal: i,
      instruction,
      detail: detail == null ? null : JSON.stringify(detail),
    });
  }
  for (const ev of input.evidence ?? []) {
    await db.insert(pmSourceEvidence).values({
      id: id("pme"),
      orgId,
      pmProgramId: pmId,
      kind: ev.kind,
      refId: ev.refId ?? null,
      detail: ev.detail ?? null,
    });
  }

  await emitEvent(orgId, "pm.suggested", {
    id: pmId,
    title: input.title,
    source: input.source ?? "manual",
  });
  await audit(orgId, actor, "pm.created", pmId, { title: input.title, source: input.source });
  return (await getProgramRow(orgId, pmId))!;
}

async function getProgramRow(orgId: string, pmId: string): Promise<PmProgram | undefined> {
  const rows = await db
    .select()
    .from(pmPrograms)
    .where(and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.id, pmId)));
  return rows[0];
}

export interface PmListItem extends PmProgram {
  assetName: string | null;
  nextDueAt: number | null;
}

export async function listPrograms(orgId: string, status?: string): Promise<PmListItem[]> {
  if (!orgId) throw new Error("listPrograms() requires orgId");
  await ensureDb();
  const where = status
    ? and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.status, status))
    : eq(pmPrograms.orgId, orgId);
  const rows = await db
    .select({
      pm: pmPrograms,
      assetName: assets.name,
      nextDueAt: pmSchedules.nextDueAt,
    })
    .from(pmPrograms)
    .leftJoin(assets, and(eq(pmPrograms.assetId, assets.id), eq(assets.orgId, orgId)))
    .leftJoin(pmSchedules, and(eq(pmSchedules.pmProgramId, pmPrograms.id), eq(pmSchedules.orgId, orgId)))
    .where(where)
    .orderBy(desc(pmPrograms.updatedAt));
  return rows.map((r) => ({
    ...r.pm,
    assetName: r.assetName ?? null,
    nextDueAt: r.nextDueAt instanceof Date ? r.nextDueAt.getTime() : (r.nextDueAt as number | null),
  }));
}

export async function getProgram(orgId: string, pmId: string): Promise<PmProgramDetail | null> {
  if (!orgId) throw new Error("getProgram() requires orgId");
  await ensureDb();
  const base = await getProgramRow(orgId, pmId);
  if (!base) return null;
  const [tasks, evidence, sched, comps, asset] = await Promise.all([
    db.select().from(pmTasks).where(and(eq(pmTasks.orgId, orgId), eq(pmTasks.pmProgramId, pmId))).orderBy(pmTasks.ordinal),
    db.select().from(pmSourceEvidence).where(and(eq(pmSourceEvidence.orgId, orgId), eq(pmSourceEvidence.pmProgramId, pmId))),
    db.select().from(pmSchedules).where(and(eq(pmSchedules.orgId, orgId), eq(pmSchedules.pmProgramId, pmId))),
    db.select().from(pmCompletions).where(and(eq(pmCompletions.orgId, orgId), eq(pmCompletions.pmProgramId, pmId))).orderBy(desc(pmCompletions.completedAt)),
    base.assetId
      ? db.select({ name: assets.name }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.id, base.assetId)))
      : Promise.resolve([] as { name: string }[]),
  ]);
  const s = sched[0];
  return {
    ...base,
    tasks: tasks.map((t) => ({
      id: t.id,
      ordinal: t.ordinal,
      instruction: t.instruction,
      detail: t.detail ? safeJson(t.detail) : null,
    })),
    evidence: evidence.map((e) => ({ kind: e.kind, refId: e.refId, detail: e.detail })),
    schedule: s
      ? {
          intervalDays: s.intervalDays,
          nextDueAt: s.nextDueAt instanceof Date ? s.nextDueAt.getTime() : (s.nextDueAt as number | null),
          active: Boolean(s.active),
        }
      : null,
    completions: comps.map((c) => ({
      id: c.id,
      status: c.status,
      completedAt: c.completedAt instanceof Date ? c.completedAt.getTime() : (c.completedAt as unknown as number),
      notes: c.notes,
    })),
    assetName: asset[0]?.name ?? null,
  };
}

// Approve a draft → active, and create its recurring schedule. Idempotent-ish:
// returns null if the PM does not exist; no-op if already active.
export async function approveProgram(
  orgId: string,
  pmId: string,
  actor: string
): Promise<PmProgram | null> {
  if (!orgId) throw new Error("approveProgram() requires orgId");
  await ensureDb();
  const pm = await getProgramRow(orgId, pmId);
  if (!pm) return null;
  if (pm.status === "active") return pm;

  const interval = pm.intervalDays ?? 30;
  const now = Date.now();
  await db
    .update(pmPrograms)
    .set({ status: "active", approvedBy: actor, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.id, pmId)));

  // One active schedule per program.
  const existing = await db
    .select()
    .from(pmSchedules)
    .where(and(eq(pmSchedules.orgId, orgId), eq(pmSchedules.pmProgramId, pmId)));
  if (existing.length === 0) {
    await db.insert(pmSchedules).values({
      id: id("pms"),
      orgId,
      pmProgramId: pmId,
      intervalDays: interval,
      nextDueAt: new Date(now + interval * DAY),
      active: true,
    });
  }
  await emitEvent(orgId, "pm.approved", { id: pmId, title: pm.title });
  await audit(orgId, actor, "pm.approved", pmId, { title: pm.title });
  return (await getProgramRow(orgId, pmId))!;
}

// Link (or relink) a draft/active PM to an asset. Used by the asset-assignment
// flow so a generated PM attaches to the right machine. Returns null if missing.
export async function assignProgramAsset(
  orgId: string,
  pmId: string,
  assetId: string | null,
  actor = "system"
): Promise<PmProgram | null> {
  if (!orgId) throw new Error("assignProgramAsset() requires orgId");
  await ensureDb();
  const pm = await getProgramRow(orgId, pmId);
  if (!pm) return null;
  // Validate the target asset belongs to this org (tenancy guard).
  if (assetId) {
    const a = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)));
    if (a.length === 0) throw new Error("assignProgramAsset(): asset not found in org");
  }
  await db
    .update(pmPrograms)
    .set({ assetId: assetId ?? null, updatedAt: new Date() })
    .where(and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.id, pmId)));
  await audit(orgId, actor, "pm.asset_assigned", pmId, { assetId });
  return (await getProgramRow(orgId, pmId))!;
}

export async function archiveProgram(orgId: string, pmId: string, actor: string): Promise<void> {
  if (!orgId) throw new Error("archiveProgram() requires orgId");
  await ensureDb();
  await db
    .update(pmPrograms)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.id, pmId)));
  await db
    .update(pmSchedules)
    .set({ active: false })
    .where(and(eq(pmSchedules.orgId, orgId), eq(pmSchedules.pmProgramId, pmId)));
  await emitEvent(orgId, "pm.archived", { id: pmId });
  await audit(orgId, actor, "pm.archived", pmId);
}

export async function recordCompletion(
  orgId: string,
  pmId: string,
  input: { status?: "done" | "skipped"; notes?: string | null; completedBy?: string | null },
  actor = "system"
): Promise<void> {
  if (!orgId) throw new Error("recordCompletion() requires orgId");
  await ensureDb();
  const sched = (
    await db
      .select()
      .from(pmSchedules)
      .where(and(eq(pmSchedules.orgId, orgId), eq(pmSchedules.pmProgramId, pmId)))
  )[0];
  await db.insert(pmCompletions).values({
    id: id("pmc"),
    orgId,
    pmProgramId: pmId,
    scheduleId: sched?.id ?? null,
    status: input.status ?? "done",
    notes: input.notes ?? null,
    completedBy: input.completedBy ?? actor,
  });
  if (sched) {
    const interval = sched.intervalDays ?? 30;
    await db
      .update(pmSchedules)
      .set({ lastCompletedAt: new Date(), nextDueAt: new Date(Date.now() + interval * DAY) })
      .where(and(eq(pmSchedules.orgId, orgId), eq(pmSchedules.id, sched.id)));
  }
  await emitEvent(orgId, "pm.completed", { id: pmId, status: input.status ?? "done" });
  await audit(orgId, actor, "pm.completed", pmId, { status: input.status ?? "done" });
}

// Active PMs whose next due date has passed — the "what needs doing" list.
export async function listDue(orgId: string): Promise<PmListItem[]> {
  if (!orgId) throw new Error("listDue() requires orgId");
  await ensureDb();
  const rows = await db
    .select({ pm: pmPrograms, assetName: assets.name, nextDueAt: pmSchedules.nextDueAt })
    .from(pmSchedules)
    .innerJoin(pmPrograms, and(eq(pmSchedules.pmProgramId, pmPrograms.id), eq(pmPrograms.orgId, orgId)))
    .leftJoin(assets, and(eq(pmPrograms.assetId, assets.id), eq(assets.orgId, orgId)))
    .where(
      and(
        eq(pmSchedules.orgId, orgId),
        eq(pmSchedules.active, true),
        lte(pmSchedules.nextDueAt, new Date())
      )
    )
    .orderBy(pmSchedules.nextDueAt);
  return rows.map((r) => ({
    ...r.pm,
    assetName: r.assetName ?? null,
    nextDueAt: r.nextDueAt instanceof Date ? r.nextDueAt.getTime() : (r.nextDueAt as number | null),
  }));
}
