import { db, ensureDb } from "@/lib/db";
import { chunks as chunksTable, documents } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { GLOBAL_ORG } from "@/lib/util";

export interface RetrievedChunk {
  id: string;
  documentId: string;
  filename: string;
  kind: string;
  ordinal: number;
  content: string;
  score: number;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "is", "are", "my",
  "why", "what", "how", "this", "that", "it", "for", "with", "i", "do", "does",
  "should", "check", "first", "show", "me",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t)
  );
}

// Lightweight TF-IDF-ish keyword retrieval over stored chunks. This is a clean
// stand-in for a vector store: swap the scoring here for cosine similarity over
// embeddings without touching callers.
export async function retrieve(
  query: string,
  opts: { assetId?: string | null; orgId: string; limit?: number }
): Promise<RetrievedChunk[]> {
  await ensureDb();
  const orgId = opts.orgId;
  if (!orgId) throw new Error("retrieve() requires opts.orgId");
  const limit = opts.limit ?? 6;

  const terms = tokenize(query);
  if (!terms.length) return [];
  const termSet = new Set(terms);

  // Pull candidate chunks. For the MVP dataset sizes this in-memory scan is
  // plenty fast; production swaps in an ANN index.
  const rows = await db
    .select({
      id: chunksTable.id,
      documentId: chunksTable.documentId,
      ordinal: chunksTable.ordinal,
      content: chunksTable.content,
      assetId: chunksTable.assetId,
      filename: documents.filename,
      kind: documents.kind,
      archivedAt: documents.archivedAt,
    })
    .from(chunksTable)
    .leftJoin(documents, eq(chunksTable.documentId, documents.id))
    // Retrieve THIS org's chunks PLUS the shared global OEM knowledge library.
    // Cross-tenant private data is never visible — only the __global__ scope is
    // unioned in, and that scope contains no tenant-identifying information.
    .where(inArray(chunksTable.orgId, [orgId, GLOBAL_ORG]));

  const scored: RetrievedChunk[] = [];
  for (const r of rows) {
    // Archived documents never surface in retrieval (and so are never cited).
    if (r.archivedAt) continue;
    // When scoped to an asset, prefer that asset's own docs, but still allow
    // GLOBAL (assetId null) knowledge through — this is what lets pre-seeded OEM
    // references answer day-one questions. We DROP only other assets' private
    // docs (a different machine's history is noise here).
    const isAssetScoped = !!opts.assetId;
    const isThisAsset = isAssetScoped && r.assetId === opts.assetId;
    const isGlobal = !r.assetId;
    if (isAssetScoped && !isThisAsset && !isGlobal) continue;

    const tokens = tokenize(r.content);
    if (!tokens.length) continue;
    let hits = 0;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (termSet.has(t)) {
        hits++;
        seen.add(t);
      }
    }
    if (hits === 0) continue;
    // Score: coverage of query terms + frequency, length-normalized.
    const coverage = seen.size / termSet.size;
    let score = coverage * 2 + hits / Math.sqrt(tokens.length);
    // Asset affinity boost: the customer's own machine docs out-rank generic
    // OEM references automatically once they upload them.
    if (isThisAsset) score *= 1.5;
    // Slight de-emphasis of generic OEM references vs. specific docs, so they
    // fill gaps rather than dominate when a real manual exists.
    else if (isGlobal && r.kind === "oem_reference") score *= 0.85;
    scored.push({
      id: r.id,
      documentId: r.documentId,
      filename: r.filename ?? "document",
      kind: r.kind ?? "document",
      ordinal: r.ordinal,
      content: r.content,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function formatContext(ctx: RetrievedChunk[]): string {
  if (!ctx.length) return "";
  return ctx
    .map(
      (c, i) =>
        `[Source ${i + 1}: ${c.filename} (${c.kind}), excerpt ${c.ordinal + 1}]\n${c.content}`
    )
    .join("\n\n---\n\n");
}
