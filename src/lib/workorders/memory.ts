// ─────────────────────────────────────────────────────────────────────────
// Maintenance Memory (Slice 4) — turn every resolved failure into reusable,
// RETRIEVABLE knowledge.
//
// The daily loop (Slice 2) captures HOW a machine-down was worked: the symptom,
// root cause, failed part, repair action, resolution, and true downtime. Until
// now that data lived only as columns on the work order — surfaced by the
// deterministic failure-lookup ONLY when a technician names the asset/part/area.
// A general Copilot question ("why does this line keep faulting after lunch?")
// never saw it.
//
// This module closes that gap. When a corrective work order is closed with any
// real close-out content, we distill it into a structured "Lesson Learned"
// document indexed through the SAME RAG pipeline as uploaded manuals — so the
// repair becomes searchable context, with citations, for the next failure. It
// flows into every existing consumer with zero extra plumbing:
//   • the asset digital-twin "Lessons" tab (documents kind=lesson),
//   • hybrid retrieval (the Copilot now cites past repairs),
//   • PM-suggestion grounding (a captured lesson raises PM confidence).
//
// Idempotency: the memory document uses a DETERMINISTIC id derived from the work
// order (mem_<woId>). Re-closing a reopened work order REPLACES its memory rather
// than duplicating it — the latest close-out is always the single source of truth.
//
// Tenancy: orgId is required and threaded through every write. The memory is
// scoped to the work order's asset (assetId may be null for area-level work, in
// which case it is org-global retrievable but not pinned to one machine).
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import { documents, chunks, type WorkOrder } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { chunkText } from "@/lib/rag/chunk";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { emitEvent, audit } from "@/lib/events";

// Deterministic document id for a work order's captured memory. Stable across
// reopen/reclose so capture is a REPLACE, never a duplicate.
export function memoryDocId(workOrderId: string): string {
  return `mem_${workOrderId}`;
}

// A close-out carries reusable knowledge only if the technician recorded what
// actually happened. A bare status flip to "done" (no resolution, root cause, or
// repair action) is not a lesson — capturing it would pollute retrieval with
// empty records, so we skip it.
export function hasCaptureContent(wo: WorkOrder): boolean {
  return Boolean(
    (wo.resolution && wo.resolution.trim()) ||
      (wo.rootCause && wo.rootCause.trim()) ||
      (wo.repairAction && wo.repairAction.trim())
  );
}

function fmtDate(v: unknown): string {
  const n = v instanceof Date ? v.getTime() : Number(v ?? 0);
  return n ? new Date(n).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

// Build the human-readable, retrievable lesson body. Kept plain-markdown and
// keyword-rich (symptom + cause + part + action) so both lexical and vector
// retrieval surface it well.
export function buildMemoryBody(wo: WorkOrder, assetLabel?: string | null): string {
  const title = wo.title?.trim() || "Resolved failure";
  const lines: string[] = [
    `# Lesson Learned — ${title}`,
    `Captured from work order ${wo.number ?? wo.id} on close (${fmtDate(wo.closedAt)}).`,
  ];
  if (assetLabel) lines.push(`Machine: ${assetLabel}`);
  if (wo.downtimeMins != null) lines.push(`Downtime: ${wo.downtimeMins} min.`);
  lines.push("");

  if (wo.symptom && wo.symptom.trim()) {
    lines.push("## Symptom (what the technician saw)", wo.symptom.trim(), "");
  }
  if (wo.rootCause && wo.rootCause.trim()) {
    lines.push("## Root cause", wo.rootCause.trim(), "");
  }
  if (wo.failedPart && wo.failedPart.trim()) {
    lines.push("## Failed part", wo.failedPart.trim(), "");
  }
  if (wo.repairAction && wo.repairAction.trim()) {
    lines.push("## Repair action", wo.repairAction.trim(), "");
  }
  if (wo.resolution && wo.resolution.trim()) {
    lines.push("## Resolution (what fixed it)", wo.resolution.trim(), "");
  }
  return lines.join("\n").trimEnd();
}

export interface MemoryResult {
  documentId: string;
  filename: string;
  chunkCount: number;
}

// Capture (or re-capture) a closed work order as a retrievable maintenance
// memory. Idempotent: replaces any prior memory for this work order.
//
// `assetLabel` is an optional human label for the machine (e.g. "CV-03 — Press
// line") used only in the document body; retrieval scoping uses wo.assetId.
export async function captureWorkOrderMemory(
  orgId: string,
  wo: WorkOrder,
  assetLabel?: string | null
): Promise<MemoryResult | null> {
  if (!orgId) throw new Error("captureWorkOrderMemory() requires orgId");
  if (!hasCaptureContent(wo)) return null; // nothing reusable to remember
  await ensureDb();

  const documentId = memoryDocId(wo.id);

  // Idempotent REPLACE: clear any prior memory doc + its chunks for this WO so a
  // reopen→reclose updates the lesson instead of stacking duplicates.
  await db
    .delete(chunks)
    .where(and(eq(chunks.orgId, orgId), eq(chunks.documentId, documentId)));
  await db
    .delete(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, documentId)));

  const body = buildMemoryBody(wo, assetLabel);
  const cleanTitle = (wo.title?.trim() || "Resolved failure").replace(/\s+/g, " ").slice(0, 90);
  const filename = `Lesson Learned — ${cleanTitle}.md`;

  // Index through the SAME pipeline as uploaded documents (kind=lesson so it
  // surfaces in the asset twin's Lessons tab and feeds PM grounding).
  const pieces = chunkText(body);

  // Embed for the hybrid retriever when a provider is available; non-fatal on
  // failure (lexical retrieval still surfaces the lesson).
  let vectors: (number[] | null)[] = pieces.map(() => null);
  try {
    const results = await getEmbeddingProvider().embedBatch(pieces);
    vectors = results.map((r) => r.vector);
  } catch {
    /* keep nulls; lexical retrieval covers it */
  }

  for (let i = 0; i < pieces.length; i++) {
    await db.insert(chunks).values({
      id: `chk_${documentId}_${i}`,
      orgId,
      documentId,
      assetId: wo.assetId ?? null,
      ordinal: i,
      content: pieces[i],
      embedding: vectors[i] ? JSON.stringify(vectors[i]) : null,
    });
  }

  await db.insert(documents).values({
    id: documentId,
    orgId,
    assetId: wo.assetId ?? null,
    filename,
    kind: "lesson",
    mimeType: "text/markdown",
    sizeBytes: body.length,
    storagePath: null,
    charCount: body.length,
  });

  await emitEvent(orgId, "document.indexed", {
    documentId,
    kind: "lesson",
    assetId: wo.assetId ?? null,
    source: "work_order_close",
    workOrderId: wo.id,
  });
  await audit(orgId, "system", "memory.captured", documentId, {
    workOrderId: wo.id,
    number: wo.number,
    assetId: wo.assetId ?? null,
  });

  return { documentId, filename, chunkCount: pieces.length };
}
