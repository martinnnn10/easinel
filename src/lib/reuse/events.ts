/**
 * Knowledge-reuse event logging — the write side of the reuse loop. Records,
 * append-only and org-scoped, when captured knowledge is surfaced and later
 * used. Every write is best-effort: a logging failure must NEVER block a
 * technician's work-order create or close-out.
 *
 * No impact/savings is computed or stored here — only the raw fact that reuse
 * happened. Avoided downtime is derived at read time from real work orders
 * (see ./impact), so a value can never be invented ahead of the evidence.
 */

import { db, ensureDb } from "@/lib/db";
import { reuseEvents, auditLog, documents } from "@/lib/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { id } from "@/lib/util";

export type ReuseEventType =
  | "prior_fix_surfaced"
  | "prior_fix_used_in_closeout"
  | "scenario_surfaced"
  | "lesson_surfaced"
  | "document_cited"
  | "pm_suggested_from_failure"
  | "pm_created_from_failure"
  | "pm_approved_from_failure";

export interface ReuseEventInput {
  eventType: ReuseEventType;
  assetId?: string | null;
  workOrderId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  surfacedToUserId?: string | null;
  originalAuthorUserId?: string | null;
  label?: string | null;
}

export async function logReuseEvent(orgId: string, e: ReuseEventInput): Promise<void> {
  if (!orgId) return;
  try {
    await ensureDb();
    await db.insert(reuseEvents).values({
      id: id("rue"),
      orgId,
      eventType: e.eventType,
      assetId: e.assetId ?? null,
      workOrderId: e.workOrderId ?? null,
      sourceType: e.sourceType ?? null,
      sourceId: e.sourceId ?? null,
      surfacedToUserId: e.surfacedToUserId ?? null,
      originalAuthorUserId: e.originalAuthorUserId ?? null,
      label: e.label ?? null,
    });
  } catch {
    /* reuse logging is best-effort — never block the daily loop */
  }
}

// The person who deserves credit for a prior fix is whoever DOCUMENTED it: the
// actor who closed that work order (workorder.status_changed → done), falling
// back to whoever created it. Returns an actor string (a user id or email); the
// read side resolves either form to a user.
export async function resolveOriginalAuthor(orgId: string, priorWoId: string): Promise<string | null> {
  try {
    await ensureDb();
    const rows = await db
      .select({ actor: auditLog.actor, action: auditLog.action, detail: auditLog.detail })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), eq(auditLog.target, priorWoId)))
      .orderBy(desc(auditLog.at));
    // Prefer the close-out actor (they wrote the fix).
    for (const r of rows) {
      if (r.action === "workorder.status_changed" && r.detail && r.detail.includes('"to":"done"')) {
        return r.actor;
      }
    }
    const created = rows.find((r) => r.action === "workorder.created");
    return created?.actor ?? null;
  } catch {
    return null;
  }
}

// A Copilot answer cited some sources. Record, per distinct source, that the
// plant's OWN captured knowledge was reused to answer a question — a lesson a
// teammate wrote (credited to its author) or a document the org uploaded.
//
// Honesty fences:
//   - Only the org's own documents count. Pre-seeded OEM / GLOBAL_ORG knowledge
//     is not the team's reuse, so citations that don't resolve to an org-owned
//     document are silently skipped.
//   - De-duped per answer: citing the same lesson twice in one answer is one
//     reuse instance, not two.
//   - Best-effort: never blocks or delays the streamed answer.
export interface CitedSource {
  documentId: string;
  filename?: string | null;
}
export async function logCitationReuse(
  orgId: string,
  citations: CitedSource[],
  opts: { assetId?: string | null; userId?: string | null } = {}
): Promise<void> {
  if (!orgId || !citations?.length) return;
  try {
    await ensureDb();
    const ids = [...new Set(citations.map((c) => c.documentId).filter(Boolean))];
    if (!ids.length) return;
    // Fence to the org's own knowledge — this excludes GLOBAL_ORG/OEM content.
    const owned = await db
      .select({ id: documents.id, kind: documents.kind, filename: documents.filename })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), inArray(documents.id, ids)));
    for (const doc of owned) {
      if (doc.kind === "lesson") {
        // A captured close-out lesson: doc id is `mem_<workOrderId>` — credit the
        // technician who documented that fix.
        const woId = doc.id.startsWith("mem_") ? doc.id.slice(4) : doc.id;
        const author = await resolveOriginalAuthor(orgId, woId);
        await logReuseEvent(orgId, {
          eventType: "lesson_surfaced",
          assetId: opts.assetId ?? null,
          sourceType: "lesson",
          sourceId: woId,
          surfacedToUserId: opts.userId ?? null,
          originalAuthorUserId: author,
          label: doc.filename,
        });
      } else {
        // An uploaded manual/drawing/SOP — no per-person author, credit the
        // knowledge base itself.
        await logReuseEvent(orgId, {
          eventType: "document_cited",
          assetId: opts.assetId ?? null,
          sourceType: "document",
          sourceId: doc.id,
          surfacedToUserId: opts.userId ?? null,
          originalAuthorUserId: null,
          label: doc.filename,
        });
      }
    }
  } catch {
    /* citation logging is best-effort — never block or delay the answer */
  }
}

// Was a prior fix surfaced for this work order at intake? Returns the surfaced
// event so a close-out can link the same source/attribution.
export async function findSurfacedEvent(orgId: string, workOrderId: string) {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(reuseEvents)
      .where(
        and(
          eq(reuseEvents.orgId, orgId),
          eq(reuseEvents.workOrderId, workOrderId),
          eq(reuseEvents.eventType, "prior_fix_surfaced")
        )
      )
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
