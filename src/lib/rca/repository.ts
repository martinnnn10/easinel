// Structured Root Cause Analysis records — the FRACAS layer over a work order.
//
// Trust rules baked in here:
//   • Org isolation: every read/write is scoped to orgId, and the parent work
//     order must belong to the same org (validated via getWorkOrder) before an
//     RCA is created or touched. A foreign workOrderId yields null → 404.
//   • Machine memory: when an RCA is saved, its canonical fields (root cause,
//     failed part, corrective action) are synced back onto the work order, so
//     repeat-risk, PM suggestion, Copilot asset context, and the Reliability
//     Report all read one source of truth — no parallel memory system.
//   • People confirm, not AI: status advances draft → technician_completed →
//     manager_confirmed only via callers that passed the right permission.

import { db, ensureDb } from "@/lib/db";
import { rootCauseAnalyses, type WorkOrder } from "@/lib/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { id } from "@/lib/util";
import { getWorkOrder, updateWorkOrder } from "@/lib/workorders/repository";

export type RcaStatus = "draft" | "technician_completed" | "manager_confirmed";
export type Rca = typeof rootCauseAnalyses.$inferSelect;

// The fields a caller may write. status/approvedBy are set by the route after
// its own permission check — never trusted straight from the client.
export interface RcaInput {
  problemStatement?: string | null;
  symptomObserved?: string | null;
  failedPart?: string | null;
  suspectedCause?: string | null;
  confirmedRootCause?: string | null;
  why1?: string | null; why2?: string | null; why3?: string | null; why4?: string | null; why5?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  verificationMethod?: string | null;
  repeatFailure?: string | null;
  aiSuggested?: boolean;
  status?: RcaStatus;
  approvedBy?: string | null;
  approvedAt?: Date | null;
}

const TEXT_KEYS: (keyof RcaInput)[] = [
  "problemStatement", "symptomObserved", "failedPart", "suspectedCause", "confirmedRootCause",
  "why1", "why2", "why3", "why4", "why5", "correctiveAction", "preventiveAction",
  "verificationMethod", "repeatFailure",
];
const clean = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 4000) || null : v ?? null);

export async function getRcaByWorkOrder(orgId: string, workOrderId: string): Promise<Rca | null> {
  if (!orgId) throw new Error("getRcaByWorkOrder() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(rootCauseAnalyses)
    .where(and(eq(rootCauseAnalyses.orgId, orgId), eq(rootCauseAnalyses.workOrderId, workOrderId)))
    .orderBy(desc(rootCauseAnalyses.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create or update the RCA for a work order. Returns null if the work order
 * doesn't belong to this org (caller should 404). Syncs canonical fields back
 * onto the work order so the rest of the intelligence loop sees the memory.
 */
export async function upsertRca(
  orgId: string,
  workOrderId: string,
  input: RcaInput,
  createdBy: string
): Promise<Rca | null> {
  if (!orgId) throw new Error("upsertRca() requires orgId");
  await ensureDb();
  const wo = await getWorkOrder(orgId, workOrderId);
  if (!wo) return null; // foreign or missing work order — never write cross-org

  const existing = await getRcaByWorkOrder(orgId, workOrderId);
  const now = new Date();

  const patch: Record<string, unknown> = { updatedAt: now };
  for (const k of TEXT_KEYS) if (input[k] !== undefined) patch[k] = clean(input[k]);
  if (input.aiSuggested !== undefined) patch.aiSuggested = input.aiSuggested;
  if (input.status !== undefined) patch.status = input.status;
  if (input.approvedBy !== undefined) patch.approvedBy = input.approvedBy;
  if (input.approvedAt !== undefined) patch.approvedAt = input.approvedAt;

  let rca: Rca;
  if (existing) {
    const rows = await db
      .update(rootCauseAnalyses)
      .set(patch)
      .where(and(eq(rootCauseAnalyses.orgId, orgId), eq(rootCauseAnalyses.id, existing.id)))
      .returning();
    rca = rows[0];
  } else {
    const rows = await db
      .insert(rootCauseAnalyses)
      .values({
        id: id("rca"),
        orgId,
        workOrderId,
        assetId: wo.assetId ?? null,
        createdBy,
        aiSuggested: input.aiSuggested ?? false,
        status: input.status ?? "draft",
        ...patch,
      })
      .returning();
    rca = rows[0];
  }

  await syncWorkOrderMemory(orgId, wo, rca);
  return rca;
}

// Push the RCA's canonical facts onto the work order. Confirmed root cause wins
// over suspected; empty values never clobber what's already recorded. This is
// what makes an RCA reusable by every downstream surface without new plumbing.
async function syncWorkOrderMemory(orgId: string, wo: WorkOrder, rca: Rca): Promise<void> {
  // Only a CONFIRMED root cause becomes the machine's authoritative root cause.
  // A suspected cause is a hypothesis — it must NOT propagate to repeat-risk, PM
  // suggestion, Copilot context, or the Reliability Report as if it were truth.
  // (confirmedRootCause is only ever set by a manager via the server-gated route.)
  const rootCause = (rca.confirmedRootCause || "").trim();
  const failedPart = (rca.failedPart || "").trim();
  const corrective = (rca.correctiveAction || "").trim();
  const woPatch: { rootCause?: string; failedPart?: string; repairAction?: string } = {};
  if (rootCause && rootCause !== (wo.rootCause ?? "")) woPatch.rootCause = rootCause;
  if (failedPart && failedPart !== (wo.failedPart ?? "")) woPatch.failedPart = failedPart;
  if (corrective && corrective !== (wo.repairAction ?? "")) woPatch.repairAction = corrective;
  if (Object.keys(woPatch).length) {
    try {
      await updateWorkOrder(orgId, wo.id, woPatch);
    } catch {
      /* memory sync is best-effort — never fail the RCA save on it */
    }
  }
}

export interface AssetRcaSummary {
  id: string;
  workOrderId: string;
  status: RcaStatus;
  rootCause: string | null; // confirmed if present, else suspected (labeled by caller)
  confirmed: boolean;
  failedPart: string | null;
  updatedAt: number;
}

// Per-asset RCA history for the asset detail page. Org-scoped.
export async function listRcaByAsset(orgId: string, assetId: string): Promise<AssetRcaSummary[]> {
  if (!orgId) throw new Error("listRcaByAsset() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(rootCauseAnalyses)
    .where(and(eq(rootCauseAnalyses.orgId, orgId), eq(rootCauseAnalyses.assetId, assetId)))
    .orderBy(desc(rootCauseAnalyses.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    workOrderId: r.workOrderId,
    status: r.status as RcaStatus,
    rootCause: r.confirmedRootCause || r.suspectedCause || null,
    confirmed: Boolean(r.confirmedRootCause) && r.status === "manager_confirmed",
    failedPart: r.failedPart,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt),
  }));
}

export interface RcaCounts {
  total: number;
  confirmed: number;
  technicianCompleted: number;
  draft: number;
  workOrderIdsWithRca: string[];
}

// Honest RCA rollup for the Reliability Report. Org-scoped; no invented numbers.
export async function rcaCounts(orgId: string): Promise<RcaCounts> {
  if (!orgId) throw new Error("rcaCounts() requires orgId");
  await ensureDb();
  const rows = await db.select().from(rootCauseAnalyses).where(eq(rootCauseAnalyses.orgId, orgId));
  return {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === "manager_confirmed").length,
    technicianCompleted: rows.filter((r) => r.status === "technician_completed").length,
    draft: rows.filter((r) => r.status === "draft").length,
    workOrderIdsWithRca: rows.map((r) => r.workOrderId),
  };
}

export interface RcaCoverage {
  failures: number; // closed corrective work orders with downtime in the window
  withRca: number; // ...that have an RCA
  needRca: number; // ...that need one (downtime, no RCA)
  confirmed: number; // RCAs with a manager-confirmed root cause
}

// Honest RCA coverage for the Reliability Report. A "failure" is a closed
// corrective work order with real downtime in the window; nothing is invented.
export async function rcaCoverage(orgId: string, windowDays = 90): Promise<RcaCoverage> {
  if (!orgId) throw new Error("rcaCoverage() requires orgId");
  const { listWorkOrders } = await import("@/lib/workorders/repository");
  const wos = await listWorkOrders(orgId);
  const since = Date.now() - windowDays * 86400_000;
  const failures = wos.filter((w) => {
    if (w.type !== "corrective" || w.status !== "done") return false;
    if (!(Number(w.downtimeMins) > 0)) return false;
    const closed = w.closedAt instanceof Date ? w.closedAt.getTime() : Number(w.closedAt ?? w.updatedAt);
    return closed >= since;
  });
  const haveRca = await rcaWorkOrderIdsIn(orgId, failures.map((w) => w.id));
  const withRca = failures.filter((w) => haveRca.has(w.id)).length;
  const counts = await rcaCounts(orgId);
  return { failures: failures.length, withRca, needRca: failures.length - withRca, confirmed: counts.confirmed };
}

// Map of workOrderId → RCA status, for the given work orders (org-scoped). Used
// by the Today board to badge each work order's RCA state without N queries.
export async function rcaStatusByWorkOrder(orgId: string, workOrderIds: string[]): Promise<Map<string, RcaStatus>> {
  if (!orgId || workOrderIds.length === 0) return new Map();
  await ensureDb();
  const rows = await db
    .select({ workOrderId: rootCauseAnalyses.workOrderId, status: rootCauseAnalyses.status })
    .from(rootCauseAnalyses)
    .where(and(eq(rootCauseAnalyses.orgId, orgId), inArray(rootCauseAnalyses.workOrderId, workOrderIds)));
  const m = new Map<string, RcaStatus>();
  for (const r of rows) m.set(r.workOrderId, r.status as RcaStatus);
  return m;
}

// Does this org already have an RCA whose work order matches these ids? (used by
// callers that need to check membership without leaking other orgs' rows).
export async function rcaWorkOrderIdsIn(orgId: string, workOrderIds: string[]): Promise<Set<string>> {
  if (!orgId || workOrderIds.length === 0) return new Set();
  await ensureDb();
  const rows = await db
    .select({ workOrderId: rootCauseAnalyses.workOrderId })
    .from(rootCauseAnalyses)
    .where(and(eq(rootCauseAnalyses.orgId, orgId), inArray(rootCauseAnalyses.workOrderId, workOrderIds)));
  return new Set(rows.map((r) => r.workOrderId));
}
