// ─────────────────────────────────────────────────────────────────────────
// Asset repository — the SINGLE isolation point for all asset data access.
//
// Why this exists:
//   Every read/write of asset data (the asset row, its photos, its alarm/fault
//   history, and the "digital twin" roll-up of everything attached to it) goes
//   through this module. Application code (API routes, the Copilot, the UI) never
//   touches Drizzle/SQL for assets directly. That means a future migration from
//   libSQL/Turso to Postgres only needs to re-implement THIS file's exported
//   functions — the rest of the product is untouched.
//
// What lives here:
//   • Rich asset CRUD (create/update/delete/list/get) with the full nameplate +
//     location + lifecycle field set.
//   • Photo gallery management (asset_photos).
//   • Alarm / fault history (alarm_events).
//   • getAssetDigitalTwin(): aggregates documents, PLC projects, work orders,
//     lessons (documents kind=lesson), alarm history, photos and troubleshooting
//     sessions into one payload, plus COMPUTED reliability metrics.
//   • buildAssetContext(): the rich text context the AI reads (replaces the thin
//     version that used to live in queries.ts).
//
// Audit + events: mutations emit a domain event (system actor) AND write an
// actor-attributed audit row so the log records WHO changed WHAT.
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import {
  assets,
  assetPhotos,
  alarmEvents,
  documents,
  conversations,
  messages,
  workOrders,
  pmPrograms,
  parts,
  partAssetLinks,
  type Asset,
  type AssetPhoto,
  type AlarmEvent,
  type Document,
  type WorkOrder,
} from "@/lib/db/schema";
export type { Asset } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { id } from "@/lib/util";
import { emitEvent, audit } from "@/lib/events";
import { listPlcProjects, type PlcProjectRow } from "@/lib/plc/store";

// ───────────────────────── Inputs / filters ─────────────────────────

export interface AssetInput {
  name: string;
  assetTag?: string | null;
  site?: string | null;
  area?: string | null;
  line?: string | null;
  cell?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  assetType?: string | null;
  parentAssetId?: string | null;
  assetLevel?: string | null;
  status?: string | null;
  criticality?: string | null;
  installedAt?: number | Date | null;
  imagePath?: string | null;
  notes?: string | null;
}

export type AssetUpdateInput = Partial<AssetInput>;

export interface AssetFilters {
  site?: string;
  area?: string;
  line?: string;
  status?: string;
  criticality?: string;
  assetType?: string;
  /** direct children of this parent asset (use "" / null via parentIsNull for roots) */
  parentAssetId?: string;
  /** when true, only return top-level assets (no parent) */
  rootsOnly?: boolean;
  /** free-text match against name / tag / manufacturer / model / serial */
  search?: string;
}

const VALID_LEVEL = ["site", "area", "line", "machine", "component", "part"];

export interface NewAssetPhoto {
  storagePath: string;
  caption?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface NewAlarmEvent {
  code?: string | null;
  message: string;
  severity?: string; // info|warning|fault|critical
  source?: string; // manual|alarm_log|historian|<connector>
  occurredAt?: number | Date;
}

const VALID_STATUS = ["operational", "degraded", "down", "maintenance", "retired"];
const VALID_CRITICALITY = ["low", "medium", "high", "critical"];

function toDate(v: number | Date | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}

// ───────────────────────── CRUD ─────────────────────────

export async function listAssets(
  orgId: string,
  filters: AssetFilters = {}
): Promise<Asset[]> {
  await ensureDb();
  const conds = [eq(assets.orgId, orgId)];
  if (filters.site) conds.push(eq(assets.site, filters.site));
  if (filters.area) conds.push(eq(assets.area, filters.area));
  if (filters.line) conds.push(eq(assets.line, filters.line));
  if (filters.status) conds.push(eq(assets.status, filters.status));
  if (filters.criticality) conds.push(eq(assets.criticality, filters.criticality));
  if (filters.assetType) conds.push(eq(assets.assetType, filters.assetType));
  if (filters.parentAssetId) conds.push(eq(assets.parentAssetId, filters.parentAssetId));
  if (filters.rootsOnly) conds.push(sql`${assets.parentAssetId} is null`);
  if (filters.search) {
    const q = `%${filters.search.toLowerCase()}%`;
    conds.push(
      sql`(lower(${assets.name}) like ${q} or lower(coalesce(${assets.assetTag},'')) like ${q} or lower(coalesce(${assets.manufacturer},'')) like ${q} or lower(coalesce(${assets.model},'')) like ${q} or lower(coalesce(${assets.serialNumber},'')) like ${q})`
    );
  }
  return db
    .select()
    .from(assets)
    .where(and(...conds))
    .orderBy(desc(assets.createdAt));
}

export async function getAsset(
  orgId: string,
  assetId: string
): Promise<Asset | undefined> {
  await ensureDb();
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)));
  return rows[0];
}

export async function createAsset(
  orgId: string,
  input: AssetInput,
  actor = "system"
): Promise<Asset> {
  await ensureDb();
  const assetId = id("ast");
  const status = input.status && VALID_STATUS.includes(input.status) ? input.status : "operational";
  const criticality =
    input.criticality && VALID_CRITICALITY.includes(input.criticality)
      ? input.criticality
      : "medium";
  await db.insert(assets).values({
    id: assetId,
    orgId,
    name: input.name?.trim() || "Unnamed Asset",
    assetTag: input.assetTag ?? null,
    site: input.site ?? null,
    area: input.area ?? null,
    line: input.line ?? null,
    cell: input.cell ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
    assetType: input.assetType ?? null,
    parentAssetId: input.parentAssetId ?? null,
    assetLevel: input.assetLevel && VALID_LEVEL.includes(input.assetLevel) ? input.assetLevel : null,
    status,
    criticality,
    installedAt: toDate(input.installedAt),
    imagePath: input.imagePath ?? null,
    notes: input.notes ?? null,
  });
  const row = (await getAsset(orgId, assetId))!;
  await emitEvent(orgId, "asset.created", {
    id: row.id,
    name: row.name,
    assetTag: row.assetTag,
    site: row.site,
    area: row.area,
    criticality: row.criticality,
  });
  await audit(orgId, actor, "asset.created", row.id, { name: row.name, tag: row.assetTag });
  return row;
}

export async function updateAsset(
  orgId: string,
  assetId: string,
  input: AssetUpdateInput,
  actor = "system"
): Promise<Asset | undefined> {
  await ensureDb();
  const existing = await getAsset(orgId, assetId);
  if (!existing) return undefined;

  const patch: Partial<typeof assets.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name?.trim() || existing.name;
  if (input.assetTag !== undefined) patch.assetTag = input.assetTag;
  if (input.site !== undefined) patch.site = input.site;
  if (input.area !== undefined) patch.area = input.area;
  if (input.line !== undefined) patch.line = input.line;
  if (input.cell !== undefined) patch.cell = input.cell;
  if (input.manufacturer !== undefined) patch.manufacturer = input.manufacturer;
  if (input.model !== undefined) patch.model = input.model;
  if (input.serialNumber !== undefined) patch.serialNumber = input.serialNumber;
  if (input.assetType !== undefined) patch.assetType = input.assetType;
  if (input.parentAssetId !== undefined) patch.parentAssetId = input.parentAssetId;
  if (input.assetLevel !== undefined)
    patch.assetLevel = input.assetLevel && VALID_LEVEL.includes(input.assetLevel) ? input.assetLevel : null;
  if (input.status != null && VALID_STATUS.includes(input.status))
    patch.status = input.status;
  if (input.criticality != null && VALID_CRITICALITY.includes(input.criticality))
    patch.criticality = input.criticality;
  if (input.installedAt !== undefined) patch.installedAt = toDate(input.installedAt);
  if (input.imagePath !== undefined) patch.imagePath = input.imagePath;
  if (input.notes !== undefined) patch.notes = input.notes;

  await db
    .update(assets)
    .set(patch)
    .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)));
  const row = await getAsset(orgId, assetId);
  await emitEvent(orgId, "asset.updated", { id: assetId, changed: Object.keys(patch) });
  await audit(orgId, actor, "asset.updated", assetId, { changed: Object.keys(patch) });
  return row;
}

export async function deleteAsset(
  orgId: string,
  assetId: string,
  actor = "system"
): Promise<boolean> {
  await ensureDb();
  const existing = await getAsset(orgId, assetId);
  if (!existing) return false;
  // Hard delete the asset row and its owned photos/alarms. Documents, work
  // orders and conversations are intentionally preserved (they carry their own
  // history); their assetId simply becomes a dangling reference, which the twin
  // aggregation tolerates. A production build would offer soft-delete + cascade
  // policy per table — that decision is isolated to this function.
  await db.delete(assetPhotos).where(and(eq(assetPhotos.orgId, orgId), eq(assetPhotos.assetId, assetId)));
  await db.delete(alarmEvents).where(and(eq(alarmEvents.orgId, orgId), eq(alarmEvents.assetId, assetId)));
  await db.delete(assets).where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)));
  await emitEvent(orgId, "asset.deleted", { id: assetId, name: existing.name });
  await audit(orgId, actor, "asset.deleted", assetId, { name: existing.name });
  return true;
}

// ───────────────────────── Photos ─────────────────────────

export async function addAssetPhoto(
  orgId: string,
  assetId: string,
  photo: NewAssetPhoto,
  actor = "system"
): Promise<AssetPhoto | undefined> {
  await ensureDb();
  const asset = await getAsset(orgId, assetId);
  if (!asset) return undefined;
  const photoId = id("aph");
  await db.insert(assetPhotos).values({
    id: photoId,
    orgId,
    assetId,
    storagePath: photo.storagePath,
    caption: photo.caption ?? null,
    mimeType: photo.mimeType ?? null,
    sizeBytes: photo.sizeBytes ?? null,
  });
  // First photo becomes the primary asset image if none is set yet.
  if (!asset.imagePath) {
    await db
      .update(assets)
      .set({ imagePath: photo.storagePath, updatedAt: new Date() })
      .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)));
  }
  await emitEvent(orgId, "asset.photo_added", { assetId, photoId });
  await audit(orgId, actor, "asset.photo_added", assetId, { photoId, caption: photo.caption });
  const rows = await db
    .select()
    .from(assetPhotos)
    .where(and(eq(assetPhotos.orgId, orgId), eq(assetPhotos.id, photoId)));
  return rows[0];
}

export async function listAssetPhotos(
  orgId: string,
  assetId: string
): Promise<AssetPhoto[]> {
  await ensureDb();
  return db
    .select()
    .from(assetPhotos)
    .where(and(eq(assetPhotos.orgId, orgId), eq(assetPhotos.assetId, assetId)))
    .orderBy(desc(assetPhotos.createdAt));
}

// ───────────────────────── Alarm / fault history ─────────────────────────

export async function addAlarmEvent(
  orgId: string,
  assetId: string,
  event: NewAlarmEvent,
  actor = "system"
): Promise<AlarmEvent | undefined> {
  await ensureDb();
  const asset = await getAsset(orgId, assetId);
  if (!asset) return undefined;
  const evtId = id("alm");
  await db.insert(alarmEvents).values({
    id: evtId,
    orgId,
    assetId,
    code: event.code ?? null,
    message: event.message,
    severity: event.severity ?? "warning",
    source: event.source ?? "manual",
    occurredAt: toDate(event.occurredAt) ?? new Date(),
  });
  await audit(orgId, actor, "alarm.recorded", assetId, { code: event.code, severity: event.severity });
  const rows = await db
    .select()
    .from(alarmEvents)
    .where(and(eq(alarmEvents.orgId, orgId), eq(alarmEvents.id, evtId)));
  return rows[0];
}

export async function listAlarmEvents(
  orgId: string,
  assetId: string,
  limit = 100
): Promise<AlarmEvent[]> {
  await ensureDb();
  return db
    .select()
    .from(alarmEvents)
    .where(and(eq(alarmEvents.orgId, orgId), eq(alarmEvents.assetId, assetId)))
    .orderBy(desc(alarmEvents.occurredAt))
    .limit(limit);
}

// ───────────────────────── Hierarchy helpers ─────────────────────────

// Direct children of an asset (one level down).
export async function listChildren(orgId: string, assetId: string): Promise<Asset[]> {
  await ensureDb();
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.parentAssetId, assetId)))
    .orderBy(desc(assets.createdAt));
}

// Ancestor chain from the immediate parent up to the root (cycle-guarded, capped).
export async function getAncestors(orgId: string, assetId: string): Promise<Asset[]> {
  await ensureDb();
  const chain: Asset[] = [];
  const seen = new Set<string>([assetId]);
  let current = await getAsset(orgId, assetId);
  let guard = 0;
  while (current?.parentAssetId && guard < 20) {
    if (seen.has(current.parentAssetId)) break; // cycle guard
    seen.add(current.parentAssetId);
    const parent = await getAsset(orgId, current.parentAssetId);
    if (!parent) break;
    chain.push(parent);
    current = parent;
    guard++;
  }
  return chain; // [immediate parent, …, root]
}

// ───────────────────────── Digital twin aggregation ─────────────────────────

export interface AssetSessionSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: number;
}

export interface ReliabilityMetrics {
  /** total recorded faults (alarm severity fault|critical) + corrective WOs */
  failureCount: number;
  /** mean time to repair in minutes, from corrective work orders' est labor */
  avgMTTRMins: number | null;
  /** fault codes (or messages) that recurred ≥2×, most frequent first */
  recurringFaults: { key: string; count: number }[];
  /** open work order count */
  openWorkOrders: number;
  /** total work order count */
  totalWorkOrders: number;
  /** days since the most recent fault/critical alarm, null if none */
  daysSinceLastFault: number | null;
  /** heuristic suggested preventive-maintenance interval in days, or null */
  suggestedPMIntervalDays: number | null;
}

export interface PmProgramSummary {
  id: string;
  title: string;
  status: string;
  frequencyLabel: string | null;
  intervalDays: number | null;
}

export interface AssetPartSummary {
  id: string;
  description: string;
  partNumber: string | null;
  manufacturer: string | null;
  category: string | null;
  position: string | null;
  criticalSpare: boolean;
}

export interface AssetDigitalTwin {
  asset: Asset;
  parent: Asset | null;
  children: Asset[];
  ancestors: Asset[];
  photos: AssetPhoto[];
  documents: Document[];
  lessons: Document[];
  plcProjects: PlcProjectRow[];
  workOrders: WorkOrder[];
  alarmEvents: AlarmEvent[];
  pmPrograms: PmProgramSummary[];
  parts: AssetPartSummary[];
  sessions: AssetSessionSummary[];
  metrics: ReliabilityMetrics;
}

function computeMetrics(
  alarms: AlarmEvent[],
  wos: WorkOrder[]
): ReliabilityMetrics {
  const faults = alarms.filter((a) => a.severity === "fault" || a.severity === "critical");
  const corrective = wos.filter((w) => w.type === "corrective");
  const failureCount = faults.length + corrective.length;

  // MTTR from corrective work orders that recorded estimated labor minutes.
  const labor = corrective
    .map((w) => Number(w.estLaborMins ?? 0))
    .filter((n) => n > 0);
  const avgMTTRMins = labor.length
    ? Math.round(labor.reduce((s, n) => s + n, 0) / labor.length)
    : null;

  // Recurring faults keyed by code (falling back to a trimmed message).
  const counts = new Map<string, number>();
  for (const a of faults) {
    const key = (a.code || a.message || "").trim().slice(0, 60);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const recurringFaults = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const openWorkOrders = wos.filter(
    (w) => w.status !== "done" && w.status !== "synced"
  ).length;

  // Days since last fault.
  let daysSinceLastFault: number | null = null;
  if (faults.length) {
    const last = Math.max(...faults.map((a) => ms(a.occurredAt)));
    daysSinceLastFault = Math.floor((Date.now() - last) / 86400_000);
  }

  // Suggested PM interval: if we have ≥2 faults, suggest half the mean time
  // between failures so PM lands before the next expected fault. Heuristic only.
  let suggestedPMIntervalDays: number | null = null;
  if (faults.length >= 2) {
    const times = faults.map((a) => ms(a.occurredAt)).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const mtbfDays = gaps.reduce((s, g) => s + g, 0) / gaps.length / 86400_000;
    suggestedPMIntervalDays = Math.max(7, Math.round(mtbfDays / 2));
  }

  return {
    failureCount,
    avgMTTRMins,
    recurringFaults,
    openWorkOrders,
    totalWorkOrders: wos.length,
    daysSinceLastFault,
    suggestedPMIntervalDays,
  };
}

export async function getAssetDigitalTwin(
  orgId: string,
  assetId: string
): Promise<AssetDigitalTwin | undefined> {
  await ensureDb();
  const asset = await getAsset(orgId, assetId);
  if (!asset) return undefined;

  const [photos, allDocs, wos, alarms, plc, sessionRows, children, ancestors, pmRows, partRows] = await Promise.all([
    listAssetPhotos(orgId, assetId),
    db
      .select()
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.assetId, assetId)))
      .orderBy(desc(documents.createdAt)),
    db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.orgId, orgId), eq(workOrders.assetId, assetId)))
      .orderBy(desc(workOrders.createdAt)),
    listAlarmEvents(orgId, assetId, 100),
    listPlcProjects(orgId, assetId),
    db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
        messageCount: sql<number>`(select count(*) from messages m where m.conversation_id = ${conversations.id})`,
      })
      .from(conversations)
      .where(and(eq(conversations.orgId, orgId), eq(conversations.assetId, assetId)))
      .orderBy(desc(conversations.updatedAt))
      .limit(50),
    listChildren(orgId, assetId),
    getAncestors(orgId, assetId),
    db
      .select({
        id: pmPrograms.id,
        title: pmPrograms.title,
        status: pmPrograms.status,
        frequencyLabel: pmPrograms.frequencyLabel,
        intervalDays: pmPrograms.intervalDays,
      })
      .from(pmPrograms)
      .where(and(eq(pmPrograms.orgId, orgId), eq(pmPrograms.assetId, assetId)))
      .orderBy(desc(pmPrograms.updatedAt)),
    // Parts used on this machine (and where) — powers the asset Parts tab.
    db
      .select({
        id: parts.id,
        description: parts.description,
        partNumber: parts.partNumber,
        manufacturer: parts.manufacturer,
        category: parts.category,
        criticalSpare: parts.criticalSpare,
        position: partAssetLinks.position,
      })
      .from(partAssetLinks)
      .innerJoin(parts, and(eq(partAssetLinks.partId, parts.id), eq(parts.orgId, orgId)))
      .where(and(eq(partAssetLinks.orgId, orgId), eq(partAssetLinks.assetId, assetId)))
      .orderBy(desc(partAssetLinks.createdAt)),
  ]);
  const parent = ancestors[0] ?? null;

  // Split lessons (kind=lesson) out of the general document list.
  const lessons = allDocs.filter((d) => d.kind === "lesson");
  const docs = allDocs.filter((d) => d.kind !== "lesson");

  const sessions: AssetSessionSummary[] = sessionRows.map((r) => ({
    id: r.id,
    title: r.title,
    messageCount: Number(r.messageCount ?? 0),
    updatedAt: ms(r.updatedAt),
  }));

  return {
    asset,
    parent,
    children,
    ancestors,
    photos,
    documents: docs,
    lessons,
    plcProjects: plc,
    workOrders: wos,
    alarmEvents: alarms,
    pmPrograms: pmRows.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      frequencyLabel: p.frequencyLabel ?? null,
      intervalDays: p.intervalDays ?? null,
    })),
    parts: partRows.map((p) => ({
      id: p.id,
      description: p.description,
      partNumber: p.partNumber ?? null,
      manufacturer: p.manufacturer ?? null,
      category: p.category ?? null,
      position: p.position ?? null,
      criticalSpare: Boolean(p.criticalSpare),
    })),
    sessions,
    metrics: computeMetrics(alarms, wos),
  };
}

// ───────────────────────── AI context builder ─────────────────────────

// Rich, retrievable text context for the Copilot. Replaces the thin version in
// queries.ts. Kept human-readable and bounded so it stays useful as a prompt.
export async function buildAssetContext(
  orgId: string,
  assetId: string
): Promise<string> {
  const twin = await getAssetDigitalTwin(orgId, assetId);
  if (!twin) return "";
  const { asset, documents: docs, plcProjects, workOrders: wos, alarmEvents: alarms, metrics, lessons } = twin;

  const loc = [asset.site, asset.area, asset.line, asset.cell].filter(Boolean).join(" / ");
  const lines: string[] = [];
  lines.push(`ASSET: ${asset.name}${asset.assetTag ? ` [${asset.assetTag}]` : ""}`);
  if (loc) lines.push(`Location: ${loc}`);
  const nameplate = [asset.manufacturer, asset.model].filter(Boolean).join(" ");
  if (nameplate) lines.push(`Nameplate: ${nameplate}${asset.serialNumber ? `, S/N ${asset.serialNumber}` : ""}`);
  if (asset.assetType) lines.push(`Type: ${asset.assetType}`);
  lines.push(`Status: ${asset.status ?? "operational"}, Criticality: ${asset.criticality ?? "medium"}`);
  if (asset.installedAt) lines.push(`Installed: ${new Date(ms(asset.installedAt)).toISOString().slice(0, 10)}`);
  if (asset.notes) lines.push(`Notes: ${asset.notes}`);

  // Reliability snapshot.
  lines.push(
    `Reliability: ${metrics.failureCount} recorded failures, ` +
      `${metrics.openWorkOrders} open of ${metrics.totalWorkOrders} work orders` +
      (metrics.avgMTTRMins != null ? `, avg MTTR ~${metrics.avgMTTRMins} min` : "") +
      (metrics.daysSinceLastFault != null ? `, last fault ${metrics.daysSinceLastFault} days ago` : "") +
      "."
  );
  if (metrics.recurringFaults.length) {
    lines.push(
      `Recurring faults: ${metrics.recurringFaults
        .map((f) => `${f.key} (×${f.count})`)
        .join(", ")}.`
    );
  }
  if (metrics.suggestedPMIntervalDays != null) {
    lines.push(`Suggested PM interval (heuristic): every ~${metrics.suggestedPMIntervalDays} days.`);
  }

  // Recent alarms.
  if (alarms.length) {
    lines.push("Recent alarms/faults:");
    for (const a of alarms.slice(0, 10)) {
      lines.push(
        `  - ${new Date(ms(a.occurredAt)).toISOString().slice(0, 10)} [${a.severity}] ${a.code ? a.code + " " : ""}${a.message}`
      );
    }
  }

  // Recent work orders.
  if (wos.length) {
    lines.push("Recent work orders:");
    for (const w of wos.slice(0, 8)) {
      lines.push(`  - ${w.number ?? w.id} (${w.status}, ${w.priority}) ${w.title}`);
    }
  }

  // PLC programs.
  if (plcProjects.length) {
    lines.push(
      `PLC programs on file: ${plcProjects
        .map((p) => `${p.filename} (${p.controllerName ?? "controller"}, ${p.routineCount} routines, fidelity ${p.fidelity})`)
        .join("; ")}.`
    );
  }

  // Lessons learned.
  if (lessons.length) {
    lines.push(`Lessons learned on file: ${lessons.map((l) => l.filename).join(", ")}.`);
  }

  // Documents.
  lines.push(
    docs.length
      ? `Documents: ${docs.map((d) => `${d.filename} (${d.kind})`).join(", ")}.`
      : "No reference documents uploaded yet."
  );

  return lines.join("\n");
}
