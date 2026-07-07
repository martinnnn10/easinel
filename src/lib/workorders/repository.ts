// ─────────────────────────────────────────────────────────────────────────
// Work order repository — the SINGLE isolation point for all work-order data
// access (the "daily habit" engine of EAS Intelligence).
//
// Why this exists (Decision 1 / Postgres-portability):
//   Every read/write of work orders, their lifecycle history, and the derived
//   OEM failure signal goes through this module. Application code (API routes,
//   the Copilot, the UI) never touches Drizzle/SQL for work orders directly.
//   A future migration from libSQL/Turso to Postgres only re-implements THIS
//   file's exported functions.
//
// What lives here:
//   • Work order CRUD with a real LIFECYCLE STATE MACHINE (open → in_progress →
//     on_hold → done) plus the legacy "synced" terminal state for CMMS push.
//   • Append-only lifecycle history (work_order_events): who moved it, when,
//     and any note — the raw material the Maintenance Memory layer distills.
//   • True downtime / MTTR from reportedAt → closedAt (not just est. labor).
//   • emitFailureSignal(): on close of a corrective WO with an OEM make/model +
//     fault code, write ONE anonymized OEM-level signal (Decision 3, the moat).
//     This is consent-gated and carries NO tenant-identifying data.
//
// Audit + events: mutations emit a domain event (system actor) AND write an
// actor-attributed audit row so the log records WHO changed WHAT.
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import {
  workOrders,
  workOrderEvents,
  oemFailureSignals,
  assets,
  type WorkOrder,
  type WorkOrderEvent,
} from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { id } from "@/lib/util";
import { emitEvent, audit } from "@/lib/events";
import { captureWorkOrderMemory } from "@/lib/workorders/memory";

// ───────────────────────── State machine ─────────────────────────

export const WO_STATUSES = [
  "open",
  "in_progress",
  "on_hold",
  "done",
  "synced",
] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

// Allowed transitions. "synced" is reachable from any non-terminal state via the
// CMMS push path (kept for backward compatibility with the integrations flow);
// "done" is the normal terminal state of the daily loop. A done WO may be
// reopened (open) if work was incomplete — plants need this.
const TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  open: ["in_progress", "on_hold", "done", "synced"],
  in_progress: ["on_hold", "done", "open", "synced"],
  on_hold: ["in_progress", "open", "done", "synced"],
  done: ["open"], // reopen
  synced: ["open", "in_progress", "done"],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true; // idempotent no-op
  const allowed = TRANSITIONS[from as WoStatus];
  return !!allowed && allowed.includes(to as WoStatus);
}

const OPEN_STATES: WoStatus[] = ["open", "in_progress", "on_hold"];
export function isOpenStatus(status: string): boolean {
  return OPEN_STATES.includes(status as WoStatus);
}

// ───────────────────────── Inputs / filters ─────────────────────────

export interface NewWorkOrder {
  title: string;
  description?: string | null;
  symptom?: string | null; // the "what's down" report
  assetId?: string | null;
  priority?: string;
  type?: string;
  assignedTo?: string | null;
  estLaborMins?: number | null;
  parts?: string[];
  safety?: string[];
  source?: string; // eas|copilot|<connectorKey>|api
}

export interface WorkOrderFilters {
  assetId?: string;
  status?: string; // exact match, or the synthetic "open" (any non-terminal)
  priority?: string;
  type?: string;
  assignedTo?: string;
  search?: string; // free-text over number/title/symptom/description
  // Approval scope. Default (undefined) returns only APPROVED work orders, so the
  // active board never shows unapproved requests. Pass "pending"/"rejected" for
  // the approvals queue, or "all" to include everything regardless of approval.
  approval?: "approved" | "pending" | "rejected" | "all";
}

let woCounter = 0;
function nextNumber(): string {
  return `WO-${Date.now().toString().slice(-6)}${(woCounter++ % 100)
    .toString()
    .padStart(2, "0")}`;
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}

function parseJsonArray(v: string[] | undefined): string | null {
  return v && v.length ? JSON.stringify(v) : null;
}

// ───────────────────────── History ─────────────────────────

async function recordEvent(
  orgId: string,
  workOrderId: string,
  e: {
    kind: WorkOrderEvent["kind"];
    fromStatus?: string | null;
    toStatus?: string | null;
    note?: string | null;
    actor?: string;
  }
): Promise<void> {
  await db.insert(workOrderEvents).values({
    id: id("woe"),
    orgId,
    workOrderId,
    kind: e.kind,
    fromStatus: e.fromStatus ?? null,
    toStatus: e.toStatus ?? null,
    note: e.note ?? null,
    actor: e.actor ?? "system",
  });
}

export async function listWorkOrderEvents(
  orgId: string,
  workOrderId: string
): Promise<WorkOrderEvent[]> {
  await ensureDb();
  return db
    .select()
    .from(workOrderEvents)
    .where(
      and(
        eq(workOrderEvents.orgId, orgId),
        eq(workOrderEvents.workOrderId, workOrderId)
      )
    )
    .orderBy(desc(workOrderEvents.at));
}

// ───────────────────────── CRUD ─────────────────────────

export async function getWorkOrder(
  orgId: string,
  woId: string
): Promise<WorkOrder | undefined> {
  await ensureDb();
  const rows = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, woId)));
  return rows[0];
}

export async function listWorkOrders(
  orgId: string,
  filters: WorkOrderFilters = {}
): Promise<WorkOrder[]> {
  await ensureDb();
  const conds = [eq(workOrders.orgId, orgId)];
  // Approval scope: default to APPROVED-only so requests awaiting sign-off never
  // appear on the active work board or in counts.
  const approval = filters.approval ?? "approved";
  if (approval !== "all") conds.push(eq(workOrders.approvalStatus, approval));
  if (filters.assetId) conds.push(eq(workOrders.assetId, filters.assetId));
  if (filters.priority) conds.push(eq(workOrders.priority, filters.priority));
  if (filters.type) conds.push(eq(workOrders.type, filters.type));
  if (filters.assignedTo) conds.push(eq(workOrders.assignedTo, filters.assignedTo));
  if (filters.status && filters.status !== "open") {
    conds.push(eq(workOrders.status, filters.status));
  } else if (filters.status === "open") {
    conds.push(inArray(workOrders.status, OPEN_STATES));
  }
  let rows = await db
    .select()
    .from(workOrders)
    .where(and(...conds))
    .orderBy(desc(workOrders.createdAt));

  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((w) =>
      [w.number, w.title, w.symptom, w.description]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }
  return rows;
}

export async function createWorkOrder(
  orgId: string,
  input: NewWorkOrder,
  actor = "system"
): Promise<WorkOrder> {
  await ensureDb();
  const woId = id("wo");
  const number = nextNumber();
  const now = new Date();

  // Org-isolation guard: assetId is user-influenced (deep links, scanned QR
  // tags, API callers), so never store one that isn't this org's own machine.
  // A foreign/unknown id is dropped to null rather than creating a dangling
  // cross-tenant reference.
  let assetId = input.assetId ?? null;
  if (assetId) {
    const owned = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)))
      .limit(1);
    if (owned.length === 0) assetId = null;
  }

  await db.insert(workOrders).values({
    id: woId,
    orgId,
    assetId,
    number,
    title: input.title,
    description: input.description ?? null,
    symptom: input.symptom ?? null,
    priority: input.priority ?? "medium",
    type: input.type ?? "corrective",
    status: "open",
    assignedTo: input.assignedTo ?? null,
    estLaborMins: input.estLaborMins ?? null,
    parts: parseJsonArray(input.parts),
    safety: parseJsonArray(input.safety),
    source: input.source ?? "eas",
    reportedAt: now,
    approvalStatus: "approved",
  });
  const row = (await getWorkOrder(orgId, woId))!;
  await recordEvent(orgId, woId, {
    kind: "created",
    toStatus: "open",
    note: input.symptom ?? input.title,
    actor,
  });
  await emitEvent(orgId, "workorder.created", {
    id: row.id,
    number: row.number,
    title: row.title,
    priority: row.priority,
    assetId: row.assetId,
    source: row.source,
  });
  await audit(orgId, actor, "workorder.created", row.id, {
    number: row.number,
    title: row.title,
    assetId: row.assetId,
  });
  // Knowledge reuse (best-effort): if the plant has already solved this fault on
  // this machine, record that prior knowledge was surfaced at intake — attributed
  // to whoever documented that prior fix. Never blocks the create.
  if ((row.type ?? "corrective") === "corrective" && (row.symptom || row.title)) {
    try {
      const { findPriorFixes } = await import("./recurrence");
      const { logReuseEvent, resolveOriginalAuthor } = await import("@/lib/reuse/events");
      const prior = await findPriorFixes(orgId, { assetId: row.assetId, symptom: row.symptom ?? row.title });
      if (prior?.last) {
        const author = await resolveOriginalAuthor(orgId, prior.last.id);
        await logReuseEvent(orgId, {
          eventType: "prior_fix_surfaced",
          assetId: row.assetId,
          workOrderId: row.id,
          sourceType: "prior_work_order",
          sourceId: prior.last.id,
          surfacedToUserId: actor,
          originalAuthorUserId: author,
          label: prior.label,
        });
      }
    } catch {
      /* reuse logging is best-effort */
    }
  }
  return row;
}

// ───────────────────────── Request → approval workflow ─────────────────────────

export interface NewWorkOrderRequest {
  title?: string | null;
  symptom: string; // what's wrong / what's needed (required for a request)
  description?: string | null;
  assetId?: string | null;
  area?: string | null; // general area affected, when no specific asset
  priority?: string;
  type?: string;
}

// Submit a MAINTENANCE REQUEST. It is created as a real work-order row but is
// born `approval_status='pending'` so it never appears on the active board or in
// open counts until a manager/supervisor approves it. Anyone with
// request_work_order may call this; approval is gated separately.
export async function createWorkOrderRequest(
  orgId: string,
  input: NewWorkOrderRequest,
  requestedBy: string
): Promise<WorkOrder> {
  await ensureDb();
  const woId = id("wo");
  const number = nextNumber();
  const now = new Date();
  const title =
    (input.title && input.title.trim()) ||
    input.symptom.trim().slice(0, 80) ||
    "Maintenance request";
  // If no specific asset, fold the affected area into the description so it is
  // not lost (assetId stays null).
  const description = [input.description, input.area ? `Affected area: ${input.area}` : null]
    .filter(Boolean)
    .join("\n") || null;
  await db.insert(workOrders).values({
    id: woId,
    orgId,
    assetId: input.assetId ?? null,
    number,
    title,
    description,
    symptom: input.symptom,
    priority: input.priority ?? "medium",
    type: input.type ?? "corrective",
    status: "open",
    source: "request",
    reportedAt: now,
    approvalStatus: "pending",
    requestedBy,
  });
  const row = (await getWorkOrder(orgId, woId))!;
  await recordEvent(orgId, woId, {
    kind: "created",
    note: `Request submitted by ${requestedBy}: ${input.symptom}`,
    actor: requestedBy,
  });
  await emitEvent(orgId, "workorder.requested", {
    id: row.id,
    number: row.number,
    title: row.title,
    requestedBy,
  });
  await audit(orgId, requestedBy, "workorder.requested", row.id, {
    number: row.number,
    title: row.title,
  });
  return row;
}

// Manager/supervisor approves a pending request → it becomes a live, approved
// work order on the active board. No-op if already approved.
export async function approveRequest(
  orgId: string,
  woId: string,
  approver: string,
  note?: string | null
): Promise<WorkOrder | undefined> {
  await ensureDb();
  const existing = await getWorkOrder(orgId, woId);
  if (!existing) return undefined;
  if (existing.approvalStatus === "approved") return existing;
  await db
    .update(workOrders)
    .set({
      approvalStatus: "approved",
      approvedBy: approver,
      approvedAt: new Date(),
      rejectionReason: null,
      status: "open",
      updatedAt: new Date(),
    })
    .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, woId)));
  await recordEvent(orgId, woId, {
    kind: "note",
    note: `Request approved by ${approver}${note ? `: ${note}` : ""}`,
    actor: approver,
  });
  await emitEvent(orgId, "workorder.approved", { id: woId, approver });
  await audit(orgId, approver, "workorder.approved", woId, { number: existing.number });
  return getWorkOrder(orgId, woId);
}

// Manager/supervisor rejects a pending request with a reason. The row is kept
// (approval_status='rejected') for the audit trail; it never enters the board.
export async function rejectRequest(
  orgId: string,
  woId: string,
  approver: string,
  reason: string
): Promise<WorkOrder | undefined> {
  await ensureDb();
  const existing = await getWorkOrder(orgId, woId);
  if (!existing) return undefined;
  await db
    .update(workOrders)
    .set({
      approvalStatus: "rejected",
      approvedBy: approver,
      approvedAt: new Date(),
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, woId)));
  await recordEvent(orgId, woId, {
    kind: "note",
    note: `Request rejected by ${approver}: ${reason}`,
    actor: approver,
  });
  await emitEvent(orgId, "workorder.rejected", { id: woId, approver });
  await audit(orgId, approver, "workorder.rejected", woId, { number: existing.number, reason });
  return getWorkOrder(orgId, woId);
}

// The approvals queue: requests in a given approval state (default pending).
export async function listRequests(
  orgId: string,
  approval: "pending" | "rejected" | "approved" = "pending"
): Promise<WorkOrder[]> {
  return listWorkOrders(orgId, { approval });
}

export async function countPendingRequests(orgId: string): Promise<number> {
  const rows = await listWorkOrders(orgId, { approval: "pending" });
  return rows.length;
}

export interface WorkOrderUpdate {
  title?: string;
  description?: string | null;
  symptom?: string | null;
  resolution?: string | null;
  priority?: string;
  type?: string;
  assignedTo?: string | null;
  estLaborMins?: number | null;
  parts?: string[];
  safety?: string[];
  rootCause?: string | null;
  failedPart?: string | null;
  repairAction?: string | null;
  downtimeMins?: number | null;
}

export async function updateWorkOrder(
  orgId: string,
  woId: string,
  input: WorkOrderUpdate,
  actor = "system"
): Promise<WorkOrder | undefined> {
  await ensureDb();
  const existing = await getWorkOrder(orgId, woId);
  if (!existing) return undefined;

  const patch: Partial<typeof workOrders.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title?.trim() || existing.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.symptom !== undefined) patch.symptom = input.symptom;
  if (input.resolution !== undefined) patch.resolution = input.resolution;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.type !== undefined) patch.type = input.type;
  if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;
  if (input.estLaborMins !== undefined) patch.estLaborMins = input.estLaborMins;
  if (input.parts !== undefined) patch.parts = parseJsonArray(input.parts);
  if (input.safety !== undefined) patch.safety = parseJsonArray(input.safety);
  if (input.rootCause !== undefined) patch.rootCause = input.rootCause;
  if (input.failedPart !== undefined) patch.failedPart = input.failedPart;
  if (input.repairAction !== undefined) patch.repairAction = input.repairAction;
  if (input.downtimeMins !== undefined) patch.downtimeMins = input.downtimeMins;

  await db
    .update(workOrders)
    .set(patch)
    .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, woId)));

  const assignmentChanged =
    input.assignedTo !== undefined && input.assignedTo !== existing.assignedTo;
  if (assignmentChanged) {
    await recordEvent(orgId, woId, {
      kind: "assignment",
      note: input.assignedTo ? `Assigned to ${input.assignedTo}` : "Unassigned",
      actor,
    });
  }
  const row = await getWorkOrder(orgId, woId);
  await emitEvent(orgId, "workorder.updated", { id: woId, changed: Object.keys(patch) });
  await audit(orgId, actor, "workorder.updated", woId, { changed: Object.keys(patch) });
  return row;
}

export interface TransitionResult {
  workOrder?: WorkOrder;
  error?: string;
}

// The heart of the daily loop. Move a work order through its lifecycle, stamping
// lifecycle timestamps, computing real downtime on close, recording history, and
// (on close of a corrective WO) emitting the anonymized OEM failure signal.
export async function transitionWorkOrder(
  orgId: string,
  woId: string,
  toStatus: string,
  opts: {
    note?: string | null;
    resolution?: string | null;
    actor?: string;
    // Explicit downtime (minutes) captured at close-out. When provided, it is
    // authoritative — the technician's real "how long was the machine actually
    // down" value overrides the wall-clock auto-estimate below. This keeps the
    // Avg-downtime KPI honest for WOs left open across shifts/weekends.
    downtimeMins?: number | null;
  } = {}
): Promise<TransitionResult> {
  await ensureDb();
  const actor = opts.actor ?? "system";
  const existing = await getWorkOrder(orgId, woId);
  if (!existing) return { error: "not_found" };

  const from = existing.status;
  // Idempotent no-op: already in the target state. Return WITHOUT re-running any
  // close-out side effects. Without this guard, a second "→ done" (a double
  // click, a retried request, or a concurrent close) would re-stamp closedAt,
  // recompute downtime, and re-emit the OEM failure signal / re-capture memory —
  // corrupting downtime metrics and double-counting the moat signal.
  if (from === toStatus) {
    return { workOrder: existing };
  }
  if (!canTransition(from, toStatus)) {
    return { error: `invalid_transition:${from}->${toStatus}` };
  }

  const now = new Date();
  const patch: Partial<typeof workOrders.$inferInsert> = {
    status: toStatus,
    updatedAt: now,
  };

  // Stamp lifecycle timestamps.
  if (toStatus === "in_progress" && !existing.startedAt) patch.startedAt = now;
  if (opts.resolution !== undefined && opts.resolution !== null) {
    patch.resolution = opts.resolution;
  }
  if (toStatus === "done") {
    patch.closedAt = now;
    if (opts.downtimeMins != null && Number.isFinite(opts.downtimeMins)) {
      // Technician-confirmed downtime wins — the honest "machine actually down"
      // figure, not the wall clock.
      patch.downtimeMins = Math.max(1, Math.round(opts.downtimeMins));
    } else {
      // Fallback estimate: reported-down → now (minutes). Overstates when a WO
      // sits open across shifts, which is exactly why close-out lets the tech
      // correct it (see CloseOutModal). Used only when no explicit value given.
      const reported = existing.reportedAt ? ms(existing.reportedAt) : ms(existing.createdAt);
      patch.downtimeMins = Math.max(1, Math.round((now.getTime() - reported) / 60000));
    }
  }
  if (toStatus === "open" && from === "done") {
    // Reopen: clear close stamps so the next close recomputes cleanly.
    patch.closedAt = null;
    patch.downtimeMins = null;
  }

  // Optimistic concurrency control: only transition if the status is STILL what
  // we read (`from`). If another request moved it first, `rowsAffected` is 0 and
  // we bail with a conflict — so two technicians closing the same work order at
  // once produce exactly one close (one downtime, one signal), not two.
  const res = await db
    .update(workOrders)
    .set(patch)
    .where(
      and(
        eq(workOrders.orgId, orgId),
        eq(workOrders.id, woId),
        eq(workOrders.status, from)
      )
    );
  // Driver-agnostic affected-row count: libSQL exposes `rowsAffected`, node-
  // postgres exposes `rowCount`. Reading both keeps this concurrency guard
  // working unchanged across a future SQLite→Postgres swap (see the PostgreSQL
  // Readiness Audit — this is the one data-integrity check that depended on a
  // driver-specific field). If neither is reported, we do NOT falsely claim a
  // conflict (affected stays undefined), so normal transitions are never blocked.
  const affected = (res as { rowsAffected?: number; rowCount?: number }).rowsAffected
    ?? (res as { rowCount?: number }).rowCount;
  if (affected === 0) {
    return { error: "concurrent_modification" };
  }

  await recordEvent(orgId, woId, {
    kind: "status",
    fromStatus: from,
    toStatus,
    note: opts.note ?? null,
    actor,
  });

  const row = await getWorkOrder(orgId, woId);
  await emitEvent(orgId, "workorder.updated", { id: woId, status: toStatus, from });
  await audit(orgId, actor, "workorder.status_changed", woId, { from, to: toStatus });

  // On close of a corrective work order, run the two knowledge-loop side effects.
  // Both are best-effort: a failure to pool a signal or index a memory must never
  // block or fail the technician's close-out.
  if (toStatus === "done" && row && row.type === "corrective") {
    // (1) Moat-aware anonymized OEM signal (Decision 3).
    await emitFailureSignal(orgId, row).catch(() => {
      /* signal emission must never block the daily loop */
    });
    // (2) Maintenance Memory (Slice 4): distill the resolved failure into a
    //     retrievable lesson so the next technician's Copilot can cite it.
    const label = await assetLabelFor(orgId, row.assetId);
    await captureWorkOrderMemory(orgId, row, label).catch(() => {
      /* memory capture must never block the daily loop */
    });
    // (3) Knowledge reuse: if prior knowledge was surfaced for this WO at intake,
    //     record that it closed with that knowledge in hand. Impact (avoided
    //     downtime) is computed later from real downtime — never invented here.
    try {
      const { findSurfacedEvent, logReuseEvent } = await import("@/lib/reuse/events");
      const surfaced = await findSurfacedEvent(orgId, row.id);
      if (surfaced) {
        await logReuseEvent(orgId, {
          eventType: "prior_fix_used_in_closeout",
          assetId: row.assetId,
          workOrderId: row.id,
          sourceType: surfaced.sourceType,
          sourceId: surfaced.sourceId,
          surfacedToUserId: surfaced.surfacedToUserId,
          originalAuthorUserId: surfaced.originalAuthorUserId,
          label: surfaced.label,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  return { workOrder: row };
}

// Legacy CMMS push terminal state — preserved for the integrations flow.
export async function markSynced(
  orgId: string,
  woId: string,
  externalSystem: string,
  externalId: string,
  actor = "system"
): Promise<WorkOrder | undefined> {
  await ensureDb();
  const existing = await getWorkOrder(orgId, woId);
  if (!existing) return undefined;
  await db
    .update(workOrders)
    .set({ status: "synced", externalSystem, externalId, updatedAt: new Date() })
    .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, woId)));
  await recordEvent(orgId, woId, {
    kind: "status",
    fromStatus: existing.status,
    toStatus: "synced",
    note: `Synced to ${externalSystem} (${externalId})`,
    actor,
  });
  await emitEvent(orgId, "workorder.synced", { id: woId, externalSystem, externalId });
  await audit(orgId, actor, "workorder.synced", woId, { externalSystem, externalId });
  return getWorkOrder(orgId, woId);
}

export async function deleteWorkOrder(
  orgId: string,
  woId: string,
  actor = "system"
): Promise<boolean> {
  await ensureDb();
  const existing = await getWorkOrder(orgId, woId);
  if (!existing) return false;
  await db
    .delete(workOrderEvents)
    .where(and(eq(workOrderEvents.orgId, orgId), eq(workOrderEvents.workOrderId, woId)));
  await db
    .delete(workOrders)
    .where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, woId)));
  await emitEvent(orgId, "workorder.updated", { id: woId, deleted: true });
  await audit(orgId, actor, "workorder.deleted", woId, { number: existing.number });
  return true;
}

// A short human label for a machine ("Name [TAG] — site / area"), used only in
// the captured memory's document body. Returns null when there is no asset.
async function assetLabelFor(orgId: string, assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  const rows = await db
    .select({
      name: assets.name,
      assetTag: assets.assetTag,
      site: assets.site,
      area: assets.area,
    })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.id, assetId)));
  const a = rows[0];
  if (!a) return null;
  const loc = [a.site, a.area].filter(Boolean).join(" / ");
  return (
    `${a.name}${a.assetTag ? ` [${a.assetTag}]` : ""}${loc ? ` — ${loc}` : ""}` || null
  );
}

// ───────────────────────── Moat: OEM failure signal ─────────────────────────

// Classify a free-text resolution into a coarse, NON-identifying category. This
// is intentionally crude and keyword-based — the point is to pool an outcome
// shape (e.g. "cooling") across customers without ever moving their text.
function classifyResolution(text: string | null | undefined): string {
  const t = (text ?? "").toLowerCase();
  if (!t) return "other";
  if (/(fan|filter|cooling|overheat|temperature|ventilation|heat)/.test(t)) return "cooling";
  if (/(bearing|belt|gearbox|coupling|misalign|lubricat|vibration|seal|mechanical)/.test(t))
    return "mechanical";
  if (/(wire|wiring|voltage|breaker|contactor|fuse|short|electrical|ground|phase)/.test(t))
    return "electrical";
  if (/(plc|program|logic|comm|network|ethernet|parameter|configuration|firmware|controls)/.test(t))
    return "controls";
  return "other";
}

// Decision 3: write ONE anonymized OEM-level failure→fix signal. This is the
// single, deliberate boundary where data leaves the tenant-private world.
// It carries NO asset id, plant, customer, or free text — only OEM make/model +
// fault code + a coarse outcome. Pooling stays OFF (sharedConsent=false) until a
// customer contractually opts in; the row is written either way so that turning
// the moat on later is a query change, not a migration.
export async function emitFailureSignal(
  orgId: string,
  wo: WorkOrder
): Promise<void> {
  await ensureDb();
  if (!wo.assetId) return;
  const assetRows = await db
    .select({
      manufacturer: assets.manufacturer,
      model: assets.model,
      assetType: assets.assetType,
    })
    .from(assets)
    .where(and(eq(assets.orgId, orgId), eq(assets.id, wo.assetId)));
  const a = assetRows[0];
  if (!a || (!a.manufacturer && !a.model)) return; // nothing poolable without an OEM identity

  // Derive a fault code from the symptom/title if present (e.g. "F007").
  const faultMatch = `${wo.symptom ?? ""} ${wo.title ?? ""}`.match(/\b([A-Z]\d{2,4})\b/);
  const consent = process.env.CROSS_CUSTOMER_LEARNING === "1"; // off by default

  await db.insert(oemFailureSignals).values({
    id: id("oem"),
    manufacturer: a.manufacturer ?? null,
    model: a.model ?? null,
    assetType: a.assetType ?? null,
    faultCode: faultMatch ? faultMatch[1] : null,
    resolutionCategory: classifyResolution(wo.resolution),
    downtimeMins: wo.downtimeMins ?? null,
    laborMins: wo.estLaborMins ?? null,
    sharedConsent: consent,
    originOrgId: orgId, // retained ONLY for tenant deletion, never pooled
  });
}

// ───────────────────────── Metrics (daily-loop KPIs) ─────────────────────────

export interface WorkOrderStats {
  open: number;
  inProgress: number;
  onHold: number;
  done: number;
  total: number;
  avgDowntimeMins: number | null; // mean true downtime of closed corrective WOs
}

export async function workOrderStats(orgId: string): Promise<WorkOrderStats> {
  const all = await listWorkOrders(orgId);
  const closedCorrective = all.filter(
    (w) => w.status === "done" && w.type === "corrective" && w.downtimeMins
  );
  const downtimes = closedCorrective.map((w) => Number(w.downtimeMins));
  return {
    open: all.filter((w) => w.status === "open").length,
    inProgress: all.filter((w) => w.status === "in_progress").length,
    onHold: all.filter((w) => w.status === "on_hold").length,
    done: all.filter((w) => w.status === "done").length,
    total: all.length,
    avgDowntimeMins: downtimes.length
      ? Math.round(downtimes.reduce((s, n) => s + n, 0) / downtimes.length)
      : null,
  };
}
