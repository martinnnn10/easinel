// ─────────────────────────────────────────────────────────────────────────
// Scenario repository — the SINGLE org-scoped access point for user-authored
// troubleshooting/training scenarios.
//
// Product rules honored here:
//  • Org isolation: orgId is REQUIRED on every function and threaded into every
//    query. A scenario id alone can never reach another tenant's scenario.
//  • Ownership + audit: create/update/delete record the actor and write an
//    actor-attributed audit row (every meaningful mutation is audited).
//  • Asset-first: a scenario without an asset is stored as status "draft" and is
//    surfaced as an "Unassigned draft" — never treated as complete.
//  • No seeding: scenarios exist ONLY because a user created them. Nothing here
//    inserts demo/sample rows into a real org.
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import { scenarios, type Scenario } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { id } from "@/lib/util";
import { audit } from "@/lib/events";

export const SKILL_LEVELS = ["apprentice", "junior", "mid", "senior", "lead"] as const;
export const SCENARIO_STATUSES = ["draft", "complete", "archived"] as const;

export interface ScenarioInput {
  title?: string;
  assetId?: string | null;
  location?: string | null;
  machineType?: string | null;
  symptom?: string | null;
  faultCode?: string | null;
  operatingCondition?: string | null;
  safetyCondition?: string | null;
  knownHistory?: string | null;
  relatedDocumentId?: string | null;
  relatedDrawingId?: string | null;
  relatedWorkOrderId?: string | null;
  relatedPmId?: string | null;
  relatedPartId?: string | null;
  expectedDiagnosticPath?: string | null;
  actualRootCause?: string | null;
  correctiveAction?: string | null;
  lessonLearned?: string | null;
  skillLevel?: string | null;
  tags?: string[] | null;
  status?: string;
}

export interface ScenarioFilters {
  assetId?: string;
  status?: "draft" | "complete" | "archived" | "all";
  search?: string;
}

function parseTags(v: string[] | null | undefined): string | null {
  return v && v.length ? JSON.stringify(v) : null;
}

// A scenario is "complete" only if it has an asset AND the core diagnostic
// content. Without an asset it can only ever be a draft (asset-first rule).
function normalizeStatus(input: ScenarioInput, existing?: Scenario): string {
  const assetId = input.assetId !== undefined ? input.assetId : existing?.assetId;
  const requested = input.status ?? existing?.status ?? "draft";
  if (requested === "archived") return "archived";
  // Cannot be "complete" without an asset — force back to draft.
  if (requested === "complete" && !assetId) return "draft";
  return requested === "complete" ? "complete" : "draft";
}

export async function listScenarios(
  orgId: string,
  filters: ScenarioFilters = {}
): Promise<Scenario[]> {
  if (!orgId) throw new Error("listScenarios() requires orgId");
  await ensureDb();
  const conds = [eq(scenarios.orgId, orgId)];
  if (filters.assetId) conds.push(eq(scenarios.assetId, filters.assetId));
  const status = filters.status ?? "all";
  if (status !== "all") conds.push(eq(scenarios.status, status));
  let rows = await db
    .select()
    .from(scenarios)
    .where(and(...conds))
    .orderBy(desc(scenarios.updatedAt));
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((s) =>
      [s.title, s.symptom, s.faultCode, s.actualRootCause, s.machineType, s.location]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }
  return rows;
}

export async function getScenario(orgId: string, scenarioId: string): Promise<Scenario | undefined> {
  if (!orgId) throw new Error("getScenario() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.orgId, orgId), eq(scenarios.id, scenarioId)));
  return rows[0];
}

export async function createScenario(
  orgId: string,
  input: ScenarioInput,
  actor = "system"
): Promise<Scenario> {
  if (!orgId) throw new Error("createScenario() requires orgId");
  await ensureDb();
  const title = (input.title || input.symptom || "Untitled scenario").trim().slice(0, 300);
  const sid = id("scn");
  await db.insert(scenarios).values({
    id: sid,
    orgId,
    title,
    assetId: input.assetId ?? null,
    location: input.location ?? null,
    machineType: input.machineType ?? null,
    symptom: input.symptom ?? null,
    faultCode: input.faultCode ?? null,
    operatingCondition: input.operatingCondition ?? null,
    safetyCondition: input.safetyCondition ?? null,
    knownHistory: input.knownHistory ?? null,
    relatedDocumentId: input.relatedDocumentId ?? null,
    relatedDrawingId: input.relatedDrawingId ?? null,
    relatedWorkOrderId: input.relatedWorkOrderId ?? null,
    relatedPmId: input.relatedPmId ?? null,
    relatedPartId: input.relatedPartId ?? null,
    expectedDiagnosticPath: input.expectedDiagnosticPath ?? null,
    actualRootCause: input.actualRootCause ?? null,
    correctiveAction: input.correctiveAction ?? null,
    lessonLearned: input.lessonLearned ?? null,
    skillLevel: input.skillLevel ?? null,
    tags: parseTags(input.tags),
    status: normalizeStatus(input),
    createdBy: actor,
    updatedBy: actor,
  });
  const row = (await getScenario(orgId, sid))!;
  await audit(orgId, actor, "scenario.created", sid, {
    title: row.title,
    assetId: row.assetId,
    status: row.status,
  });
  return row;
}

export async function updateScenario(
  orgId: string,
  scenarioId: string,
  input: ScenarioInput,
  actor = "system"
): Promise<Scenario | undefined> {
  if (!orgId) throw new Error("updateScenario() requires orgId");
  await ensureDb();
  const existing = await getScenario(orgId, scenarioId);
  if (!existing) return undefined;

  const patch: Partial<typeof scenarios.$inferInsert> = { updatedAt: new Date(), updatedBy: actor };
  const setIf = <K extends keyof ScenarioInput>(k: K, col: keyof typeof patch) => {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[col as string] = input[k];
  };
  if (input.title !== undefined) patch.title = (input.title || existing.title).trim().slice(0, 300);
  setIf("assetId", "assetId");
  setIf("location", "location");
  setIf("machineType", "machineType");
  setIf("symptom", "symptom");
  setIf("faultCode", "faultCode");
  setIf("operatingCondition", "operatingCondition");
  setIf("safetyCondition", "safetyCondition");
  setIf("knownHistory", "knownHistory");
  setIf("relatedDocumentId", "relatedDocumentId");
  setIf("relatedDrawingId", "relatedDrawingId");
  setIf("relatedWorkOrderId", "relatedWorkOrderId");
  setIf("relatedPmId", "relatedPmId");
  setIf("relatedPartId", "relatedPartId");
  setIf("expectedDiagnosticPath", "expectedDiagnosticPath");
  setIf("actualRootCause", "actualRootCause");
  setIf("correctiveAction", "correctiveAction");
  setIf("lessonLearned", "lessonLearned");
  setIf("skillLevel", "skillLevel");
  if (input.tags !== undefined) patch.tags = parseTags(input.tags);
  if (input.status !== undefined || input.assetId !== undefined) {
    patch.status = normalizeStatus(input, existing);
  }

  await db
    .update(scenarios)
    .set(patch)
    .where(and(eq(scenarios.orgId, orgId), eq(scenarios.id, scenarioId)));
  const row = await getScenario(orgId, scenarioId);
  await audit(orgId, actor, "scenario.updated", scenarioId, { changed: Object.keys(patch) });
  return row;
}

// Archive (soft delete) keeps the record for history; hard delete removes it.
export async function archiveScenario(orgId: string, scenarioId: string, actor = "system"): Promise<Scenario | undefined> {
  return updateScenario(orgId, scenarioId, { status: "archived" }, actor);
}

export async function deleteScenario(orgId: string, scenarioId: string, actor = "system"): Promise<boolean> {
  if (!orgId) throw new Error("deleteScenario() requires orgId");
  await ensureDb();
  const existing = await getScenario(orgId, scenarioId);
  if (!existing) return false;
  await db.delete(scenarios).where(and(eq(scenarios.orgId, orgId), eq(scenarios.id, scenarioId)));
  await audit(orgId, actor, "scenario.deleted", scenarioId, { title: existing.title });
  return true;
}

// Bulk existence check scoped to org (used by tests / integrity checks).
export async function scenarioIdsInOrg(orgId: string, ids: string[]): Promise<string[]> {
  if (!orgId || !ids.length) return [];
  await ensureDb();
  const rows = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.orgId, orgId), inArray(scenarios.id, ids)));
  return rows.map((r) => r.id);
}
