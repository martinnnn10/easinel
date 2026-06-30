// Parts repository — the seed of EAS Industrial Search. Today it is a clean
// parts catalog with multi-field free-text search; the schema (parts +
// part_links) is deliberately built so parts can later link to assets, work
// orders, PMs, suppliers, manuals, and failure history without a rewrite.
//
// Search is intentionally a single isolation point: the keyword scorer here can
// be swapped for the embeddings index (src/lib/embeddings) or a hybrid ranker
// to power "blue photoeye on conveyor 3" style queries — callers don't change.
//
// Tenancy: every function REQUIRES orgId as its first parameter. There is no
// shared/default org fallback — a missing org is a hard error.

import { db, ensureDb } from "@/lib/db";
import {
  parts,
  partLinks,
  partAliases,
  partAssetLinks,
  partWorkOrderLinks,
  partPmLinks,
  partSourceEvidence,
  partSuppliers,
  assets,
  workOrders,
  pmPrograms,
  type Part,
  type PartAlias,
  type PartSupplier,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id } from "@/lib/util";
import { emitEvent, audit } from "@/lib/events";

export interface NewPart {
  description: string;
  partNumber?: string | null;
  manufacturer?: string | null;
  manufacturerPartNumber?: string | null;
  category?: string | null;
  unit?: string | null;
}

export async function createPart(orgId: string, input: NewPart, actor = "system"): Promise<Part> {
  if (!orgId) throw new Error("createPart() requires orgId");
  await ensureDb();
  const partId = id("prt");
  await db.insert(parts).values({
    id: partId,
    orgId,
    description: input.description,
    partNumber: input.partNumber ?? null,
    manufacturer: input.manufacturer ?? null,
    manufacturerPartNumber: input.manufacturerPartNumber ?? null,
    category: input.category ?? null,
    unit: input.unit ?? "each",
  });
  await emitEvent(orgId, "part.created", { id: partId, description: input.description });
  await audit(orgId, actor, "part.created", partId, { description: input.description });
  return (await db.select().from(parts).where(and(eq(parts.orgId, orgId), eq(parts.id, partId))))[0];
}

export async function listParts(orgId: string): Promise<Part[]> {
  if (!orgId) throw new Error("listParts() requires orgId");
  await ensureDb();
  return db.select().from(parts).where(eq(parts.orgId, orgId)).orderBy(desc(parts.createdAt));
}

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1);
}

export interface PartHit extends Part {
  score: number;
}

// Multi-field free-text search across part number, mfr number, manufacturer,
// description, and category. Foundation for the broader Industrial Search that
// will also span assets, fault codes, PLC tags, and serial numbers.
export async function searchParts(orgId: string, query: string, limit = 25): Promise<PartHit[]> {
  if (!orgId) throw new Error("searchParts() requires orgId");
  await ensureDb();
  const rows = await db.select().from(parts).where(eq(parts.orgId, orgId));
  const terms = tokens(query);
  if (!terms.length) return rows.slice(0, limit).map((p) => ({ ...p, score: 0 }));

  const scored: PartHit[] = [];
  for (const p of rows) {
    const haystack = [
      p.partNumber,
      p.manufacturerPartNumber,
      p.manufacturer,
      p.description,
      p.category,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!haystack.includes(t)) continue;
      // Exact part-number matches rank highest.
      if ((p.partNumber ?? "").toLowerCase() === t || (p.manufacturerPartNumber ?? "").toLowerCase() === t)
        score += 5;
      else score += 1;
    }
    if (score > 0) scored.push({ ...p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// Link a part to an asset / work order / PM (foundation for the connected graph).
export async function linkPart(
  orgId: string,
  partId: string,
  targetType: "asset" | "work_order" | "pm",
  targetId: string
): Promise<void> {
  if (!orgId) throw new Error("linkPart() requires orgId");
  await ensureDb();
  await db.insert(partLinks).values({
    id: id("plk"),
    orgId,
    partId,
    targetType,
    targetId,
  });
}

// ───────────────────────── Phase 2: detail + aliases + Field Memory ─────────────────────────

export async function getPart(orgId: string, partId: string): Promise<Part | undefined> {
  if (!orgId) throw new Error("getPart() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(parts)
    .where(and(eq(parts.orgId, orgId), eq(parts.id, partId)));
  return rows[0];
}

const PART_EDITABLE = [
  "description", "partNumber", "manufacturer", "manufacturerPartNumber", "category",
  "unit", "replacementNotes", "criticalSpare", "preferredSupplier", "supplierUrl",
  "manufacturerUrl", "estLeadTime", "estPrice", "stockQty", "reorderPoint",
  "alternatePartNumbers", "status",
] as const;

export async function updatePart(
  orgId: string,
  partId: string,
  input: Record<string, unknown>,
  actor = "system"
): Promise<Part | undefined> {
  if (!orgId) throw new Error("updatePart() requires orgId");
  await ensureDb();
  const existing = await getPart(orgId, partId);
  if (!existing) return undefined;
  const patch: Record<string, unknown> = {};
  for (const k of PART_EDITABLE) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  if (Object.keys(patch).length === 0) return existing;
  await db.update(parts).set(patch).where(and(eq(parts.orgId, orgId), eq(parts.id, partId)));
  await emitEvent(orgId, "part.updated", { id: partId, changed: Object.keys(patch) });
  await audit(orgId, actor, "part.updated", partId, { changed: Object.keys(patch) });
  return getPart(orgId, partId);
}

export async function addAlias(
  orgId: string,
  partId: string,
  alias: string,
  kind = "alt_pn",
  actor = "system"
): Promise<PartAlias | undefined> {
  if (!orgId) throw new Error("addAlias() requires orgId");
  await ensureDb();
  const part = await getPart(orgId, partId);
  if (!part) return undefined;
  const aliasId = id("pal");
  await db.insert(partAliases).values({ id: aliasId, orgId, partId, alias: alias.trim(), kind });
  await emitEvent(orgId, "part.alias_added", { partId, alias });
  await audit(orgId, actor, "part.alias_added", partId, { alias, kind });
  return (await db.select().from(partAliases).where(eq(partAliases.id, aliasId)))[0];
}

export async function listAliases(orgId: string, partId: string): Promise<PartAlias[]> {
  if (!orgId) throw new Error("listAliases() requires orgId");
  await ensureDb();
  return db
    .select()
    .from(partAliases)
    .where(and(eq(partAliases.orgId, orgId), eq(partAliases.partId, partId)));
}

export interface FieldMemory {
  part: Part;
  aliases: PartAlias[];
  assets: { assetId: string; name: string | null; position: string | null }[];
  workOrders: {
    workOrderId: string;
    number: string | null;
    title: string;
    role: string;
    status: string;
    closedAt: number | null;
    downtimeMins: number | null;
    assignedTo: string | null;
  }[];
  pms: { pmProgramId: string; title: string; status: string }[];
  failure: {
    failureCount: number;
    lastFailedAt: number | null;
    avgDowntimeMins: number | null;
    replacedBy: string[];
  };
  suppliers: PartSupplier[];
}

// The "Field Memory" for a part: where it's used, how it has failed, what
// inspects it. All org-scoped; aggregates computed from real linked records.
export async function getFieldMemory(orgId: string, partId: string): Promise<FieldMemory | null> {
  if (!orgId) throw new Error("getFieldMemory() requires orgId");
  await ensureDb();
  const part = await getPart(orgId, partId);
  if (!part) return null;

  const [aliases, assetRows, woRows, pmRows, suppliers] = await Promise.all([
    listAliases(orgId, partId),
    db
      .select({ assetId: partAssetLinks.assetId, name: assets.name, position: partAssetLinks.position })
      .from(partAssetLinks)
      .leftJoin(assets, eq(partAssetLinks.assetId, assets.id))
      .where(and(eq(partAssetLinks.orgId, orgId), eq(partAssetLinks.partId, partId))),
    db
      .select({
        workOrderId: partWorkOrderLinks.workOrderId,
        role: partWorkOrderLinks.role,
        number: workOrders.number,
        title: workOrders.title,
        status: workOrders.status,
        closedAt: workOrders.closedAt,
        downtimeMins: workOrders.downtimeMins,
        assignedTo: workOrders.assignedTo,
      })
      .from(partWorkOrderLinks)
      .leftJoin(workOrders, eq(partWorkOrderLinks.workOrderId, workOrders.id))
      .where(and(eq(partWorkOrderLinks.orgId, orgId), eq(partWorkOrderLinks.partId, partId))),
    db
      .select({ pmProgramId: partPmLinks.pmProgramId, title: pmPrograms.title, status: pmPrograms.status })
      .from(partPmLinks)
      .leftJoin(pmPrograms, eq(partPmLinks.pmProgramId, pmPrograms.id))
      .where(and(eq(partPmLinks.orgId, orgId), eq(partPmLinks.partId, partId))),
    listSuppliers(orgId, partId),
  ]);

  const num = (v: unknown): number | null =>
    v instanceof Date ? v.getTime() : typeof v === "number" ? v : null;

  const failures = woRows.filter((w) => w.role === "failed");
  const downtimes = failures.map((w) => num(w.downtimeMins)).filter((n): n is number => n != null);
  const failTimes = failures.map((w) => num(w.closedAt)).filter((n): n is number => n != null);
  const replacedBy = Array.from(
    new Set(failures.map((w) => w.assignedTo).filter((a): a is string => Boolean(a)))
  );

  return {
    part,
    aliases,
    assets: assetRows.map((a) => ({ assetId: a.assetId, name: a.name ?? null, position: a.position ?? null })),
    workOrders: woRows.map((w) => ({
      workOrderId: w.workOrderId,
      number: w.number ?? null,
      title: w.title ?? "(work order)",
      role: w.role,
      status: w.status ?? "unknown",
      closedAt: num(w.closedAt),
      downtimeMins: num(w.downtimeMins),
      assignedTo: w.assignedTo ?? null,
    })),
    pms: pmRows.map((p) => ({ pmProgramId: p.pmProgramId, title: p.title ?? "(PM)", status: p.status ?? "unknown" })),
    failure: {
      failureCount: failures.length,
      lastFailedAt: failTimes.length ? Math.max(...failTimes) : null,
      avgDowntimeMins: downtimes.length
        ? Math.round(downtimes.reduce((a, b) => a + b, 0) / downtimes.length)
        : null,
      replacedBy,
    },
    suppliers,
  };
}

// ───────────────────────── Phase 4: typed links ─────────────────────────

async function linkExists(table: "asset" | "wo" | "pm", orgId: string, partId: string, refId: string): Promise<boolean> {
  if (table === "asset") {
    const r = await db.select({ id: partAssetLinks.id }).from(partAssetLinks)
      .where(and(eq(partAssetLinks.orgId, orgId), eq(partAssetLinks.partId, partId), eq(partAssetLinks.assetId, refId)));
    return r.length > 0;
  }
  if (table === "pm") {
    const r = await db.select({ id: partPmLinks.id }).from(partPmLinks)
      .where(and(eq(partPmLinks.orgId, orgId), eq(partPmLinks.partId, partId), eq(partPmLinks.pmProgramId, refId)));
    return r.length > 0;
  }
  const r = await db.select({ id: partWorkOrderLinks.id }).from(partWorkOrderLinks)
    .where(and(eq(partWorkOrderLinks.orgId, orgId), eq(partWorkOrderLinks.partId, partId), eq(partWorkOrderLinks.workOrderId, refId)));
  return r.length > 0;
}

export async function linkAsset(orgId: string, partId: string, assetId: string, position: string | null, actor = "system"): Promise<void> {
  if (!orgId) throw new Error("linkAsset() requires orgId");
  await ensureDb();
  if (await linkExists("asset", orgId, partId, assetId)) return;
  await db.insert(partAssetLinks).values({ id: id("pal"), orgId, partId, assetId, position: position ?? null });
  await emitEvent(orgId, "part.linked", { partId, assetId });
  await audit(orgId, actor, "part.linked_asset", partId, { assetId });
}

export async function linkWorkOrder(orgId: string, partId: string, workOrderId: string, role = "used", actor = "system"): Promise<void> {
  if (!orgId) throw new Error("linkWorkOrder() requires orgId");
  await ensureDb();
  if (!(await linkExists("wo", orgId, partId, workOrderId))) {
    await db.insert(partWorkOrderLinks).values({ id: id("pwl"), orgId, partId, workOrderId, role });
  }
  if (role === "failed") await emitEvent(orgId, "part.failed", { partId, workOrderId });
  await audit(orgId, actor, "part.linked_work_order", partId, { workOrderId, role });
}

export async function linkPm(orgId: string, partId: string, pmProgramId: string, actor = "system"): Promise<void> {
  if (!orgId) throw new Error("linkPm() requires orgId");
  await ensureDb();
  if (await linkExists("pm", orgId, partId, pmProgramId)) return;
  await db.insert(partPmLinks).values({ id: id("ppl"), orgId, partId, pmProgramId });
  await audit(orgId, actor, "part.linked_pm", partId, { pmProgramId });
}

export interface FailedPartResult {
  partId: string;
  failureCount: number;
  suggestCriticalSpare: boolean;
  suggestPmInspection: boolean;
}

// Phase 4: record a failed part against a work order. Links the part⇆WO as
// "failed", links the WO's asset, and returns rule-based suggestions.
export async function recordFailedPart(
  orgId: string,
  input: { workOrderId: string; partId?: string; newPart?: NewPart },
  actor = "system"
): Promise<FailedPartResult> {
  if (!orgId) throw new Error("recordFailedPart() requires orgId");
  await ensureDb();

  let partId = input.partId ?? "";
  if (!partId) {
    if (!input.newPart?.description) throw new Error("recordFailedPart() needs partId or newPart");
    const created = await createPart(orgId, input.newPart, actor);
    partId = created.id;
  } else {
    const exists = await getPart(orgId, partId);
    if (!exists) throw new Error("part not found in org");
  }

  await linkWorkOrder(orgId, partId, input.workOrderId, "failed", actor);

  // Link the work order's asset to the part (asset part history).
  const wo = (
    await db.select({ assetId: workOrders.assetId }).from(workOrders)
      .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, input.workOrderId)))
  )[0];
  if (wo?.assetId) await linkAsset(orgId, partId, wo.assetId, null, actor);

  // Rule-based suggestions (no AI): repeat failures → stock it / inspect it.
  const failCount = (
    await db.select({ id: partWorkOrderLinks.id }).from(partWorkOrderLinks)
      .where(and(eq(partWorkOrderLinks.orgId, orgId), eq(partWorkOrderLinks.partId, partId), eq(partWorkOrderLinks.role, "failed")))
  ).length;
  const part = await getPart(orgId, partId);
  const pmCount = (await db.select({ id: partPmLinks.id }).from(partPmLinks)
    .where(and(eq(partPmLinks.orgId, orgId), eq(partPmLinks.partId, partId)))).length;

  return {
    partId,
    failureCount: failCount,
    suggestCriticalSpare: failCount >= 2 && !part?.criticalSpare,
    suggestPmInspection: failCount >= 2 && pmCount === 0,
  };
}

// ───────────────────────── Phase 5: suppliers ─────────────────────────

export async function addSupplier(
  orgId: string,
  partId: string,
  input: { name: string; url?: string | null; leadTime?: string | null; price?: string | null; notes?: string | null },
  actor = "system"
): Promise<PartSupplier | undefined> {
  if (!orgId) throw new Error("addSupplier() requires orgId");
  await ensureDb();
  const part = await getPart(orgId, partId);
  if (!part) return undefined;
  const supId = id("psp");
  await db.insert(partSuppliers).values({
    id: supId, orgId, partId,
    name: input.name.trim(),
    url: input.url ?? null,
    leadTime: input.leadTime ?? null,
    price: input.price ?? null,
    notes: input.notes ?? null,
  });
  await emitEvent(orgId, "part.supplier_added", { partId, name: input.name });
  await audit(orgId, actor, "part.supplier_added", partId, { name: input.name });
  return (await db.select().from(partSuppliers).where(eq(partSuppliers.id, supId)))[0];
}

export async function listSuppliers(orgId: string, partId: string): Promise<PartSupplier[]> {
  if (!orgId) throw new Error("listSuppliers() requires orgId");
  await ensureDb();
  return db
    .select()
    .from(partSuppliers)
    .where(and(eq(partSuppliers.orgId, orgId), eq(partSuppliers.partId, partId)))
    .orderBy(desc(partSuppliers.createdAt));
}

export async function addSourceEvidence(
  orgId: string,
  partId: string,
  kind: string,
  refId: string | null,
  detail: string | null
): Promise<void> {
  if (!orgId) throw new Error("addSourceEvidence() requires orgId");
  await ensureDb();
  await db.insert(partSourceEvidence).values({ id: id("pse"), orgId, partId, kind, refId, detail });
}
