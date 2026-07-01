// Persist a generated RCA as a retrievable Knowledge document (kind="rca"),
// scoped to the asset. Idempotent per work order (rca_<woId>): regenerating
// replaces rather than duplicating. Indexed through the same RAG pipeline so the
// Copilot can cite past RCAs. Mirrors the Maintenance-Memory capture pattern.

import { db, ensureDb } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { chunkText } from "@/lib/rag/chunk";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { emitEvent, audit } from "@/lib/events";
import type { RcaReport } from "./generate";

export function rcaDocId(workOrderId: string): string {
  return `rca_${workOrderId}`;
}

export interface SavedRca {
  documentId: string;
  filename: string;
  chunkCount: number;
}

export async function saveRca(orgId: string, rca: RcaReport, actor = "system"): Promise<SavedRca> {
  if (!orgId) throw new Error("saveRca() requires orgId");
  await ensureDb();
  const documentId = rcaDocId(rca.workOrderId);

  // Idempotent replace.
  await db.delete(chunks).where(and(eq(chunks.orgId, orgId), eq(chunks.documentId, documentId)));
  await db.delete(documents).where(and(eq(documents.orgId, orgId), eq(documents.id, documentId)));

  const filename = `${rca.title}.md`.replace(/\s+/g, " ");
  const pieces = chunkText(rca.markdown);

  let vectors: (number[] | null)[] = pieces.map(() => null);
  try {
    const results = await getEmbeddingProvider().embedBatch(pieces);
    vectors = results.map((r) => r.vector);
  } catch {
    /* lexical retrieval still covers it */
  }

  for (let i = 0; i < pieces.length; i++) {
    await db.insert(chunks).values({
      id: `chk_${documentId}_${i}`,
      orgId,
      documentId,
      assetId: rca.assetId ?? null,
      ordinal: i,
      content: pieces[i],
      embedding: vectors[i] ? JSON.stringify(vectors[i]) : null,
    });
  }
  await db.insert(documents).values({
    id: documentId,
    orgId,
    assetId: rca.assetId ?? null,
    filename,
    kind: "rca",
    mimeType: "text/markdown",
    sizeBytes: rca.markdown.length,
    storagePath: null,
    charCount: rca.markdown.length,
  });

  await emitEvent(orgId, "document.indexed", {
    documentId,
    kind: "rca",
    assetId: rca.assetId ?? null,
    workOrderId: rca.workOrderId,
  });
  await audit(orgId, actor, "rca.saved", documentId, { workOrderId: rca.workOrderId, confidence: rca.confidence });

  return { documentId, filename, chunkCount: pieces.length };
}
