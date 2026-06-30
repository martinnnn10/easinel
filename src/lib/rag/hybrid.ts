import { db, ensureDb } from "@/lib/db";
import { chunks as chunksTable, documents } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { GLOBAL_ORG } from "@/lib/util";
import { retrieve, type RetrievedChunk } from "./retrieve";
import { getReranker } from "./rerank";
import { getEmbeddingProvider, cosineSimilarity } from "@/lib/embeddings";

// ───────────────────────── Public contracts ─────────────────────────

export interface Citation {
  /** 1-based citation marker used in the answer, e.g. [1]. */
  marker: number;
  documentId: string;
  chunkId: string;
  filename: string;
  kind: string;
  excerpt: number; // human-friendly (ordinal + 1)
  snippet: string; // short preview for the UI
  relevance: number; // reranker relevance [0,1]
}

export interface RetrievalDiagnostics {
  lexicalCandidates: number;
  vectorCandidates: number;
  fusedCandidates: number;
  returned: number;
  embeddingProvider: string;
  semanticEmbeddings: boolean;
  reranker: string;
  fusion: "rrf-hybrid" | "lexical-only";
  rerankMovement: number; // sum of |delta| — how much rerank changed order
  topScore: number;
  scoreMargin: number; // top1 - top2 (separation)
  latencyMs: number;
}

export interface HybridResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  confidence: number; // [0,1]
  confidenceLabel: "high" | "medium" | "low";
  diagnostics: RetrievalDiagnostics;
}

// Reciprocal Rank Fusion constant (standard default).
const RRF_K = 60;

function snippet(text: string, n = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n) + "…" : clean;
}

// ───────────────────────── Vector candidate retrieval ─────────────────────────

async function vectorCandidates(
  query: string,
  orgId: string,
  assetId: string | null | undefined,
  limit: number
): Promise<{ chunk: RetrievedChunk; sim: number }[]> {
  const provider = getEmbeddingProvider();
  // Embed the query once. If embedding fails, the caller falls back to lexical.
  let qvec: number[];
  try {
    qvec = (await provider.embed(query)).vector;
  } catch {
    return [];
  }

  const rows = await db
    .select({
      id: chunksTable.id,
      documentId: chunksTable.documentId,
      ordinal: chunksTable.ordinal,
      content: chunksTable.content,
      assetId: chunksTable.assetId,
      embedding: chunksTable.embedding,
      filename: documents.filename,
      kind: documents.kind,
    })
    .from(chunksTable)
    .leftJoin(documents, eq(chunksTable.documentId, documents.id))
    .where(inArray(chunksTable.orgId, [orgId, GLOBAL_ORG]));

  const out: { chunk: RetrievedChunk; sim: number }[] = [];
  for (const r of rows) {
    if (!r.embedding) continue; // only chunks that were embedded participate
    // Respect asset scoping (same rule as lexical retrieval).
    const isAssetScoped = !!assetId;
    const isThisAsset = isAssetScoped && r.assetId === assetId;
    const isGlobal = !r.assetId;
    if (isAssetScoped && !isThisAsset && !isGlobal) continue;

    let vec: number[];
    try {
      vec = JSON.parse(r.embedding) as number[];
    } catch {
      continue;
    }
    if (vec.length !== qvec.length) continue; // dimension mismatch → skip (re-index needed)
    const sim = cosineSimilarity(qvec, vec);
    if (sim <= 0) continue;
    out.push({
      chunk: {
        id: r.id,
        documentId: r.documentId,
        filename: r.filename ?? "document",
        kind: r.kind ?? "document",
        ordinal: r.ordinal,
        content: r.content,
        score: sim,
      },
      sim,
    });
  }
  out.sort((a, b) => b.sim - a.sim);
  return out.slice(0, limit * 3);
}

// ───────────────────────── Hybrid retrieval ─────────────────────────

export async function hybridRetrieve(
  query: string,
  opts: { orgId: string; assetId?: string | null; limit?: number }
): Promise<HybridResult> {
  const startedAt = Date.now();
  await ensureDb();
  if (!opts.orgId) throw new Error("hybridRetrieve() requires opts.orgId");
  const limit = opts.limit ?? 6;
  const provider = getEmbeddingProvider();

  // 1) Lexical candidates (always available).
  const lexical = await retrieve(query, {
    orgId: opts.orgId,
    assetId: opts.assetId ?? null,
    limit: limit * 3,
  });

  // 2) Vector candidates (only when embeddings exist on chunks).
  const vector = await vectorCandidates(query, opts.orgId, opts.assetId, limit);

  // 3) Reciprocal Rank Fusion of the two ranked lists.
  const fused = new Map<string, { chunk: RetrievedChunk; rrf: number }>();
  lexical.forEach((c, i) => {
    fused.set(c.id, { chunk: c, rrf: 1 / (RRF_K + i + 1) });
  });
  vector.forEach((v, i) => {
    const existing = fused.get(v.chunk.id);
    const contribution = 1 / (RRF_K + i + 1);
    if (existing) existing.rrf += contribution;
    else fused.set(v.chunk.id, { chunk: v.chunk, rrf: contribution });
  });

  const usedVector = vector.length > 0;
  const fusedSorted = [...fused.values()].sort((a, b) => b.rrf - a.rrf);
  const preRerank = fusedSorted.slice(0, Math.max(limit * 2, 8)).map((f) => f.chunk);

  // 4) Rerank the fused shortlist.
  const reranker = getReranker();
  const reranked = await reranker.rerank(query, preRerank);
  const rerankMovement = reranked.reduce((s, r) => s + Math.abs(r.delta), 0);

  const top = reranked.slice(0, limit);
  const chunks = top.map((r) => ({ ...r.chunk, score: r.relevance }));

  // 5) Build structured citations.
  const citations: Citation[] = top.map((r, i) => ({
    marker: i + 1,
    documentId: r.chunk.documentId,
    chunkId: r.chunk.id,
    filename: r.chunk.filename,
    kind: r.chunk.kind,
    excerpt: r.chunk.ordinal + 1,
    snippet: snippet(r.chunk.content),
    relevance: r.relevance,
  }));

  // 6) Confidence scoring — a real signal, not a hardcoded label.
  const topRel = top[0]?.relevance ?? 0;
  const secondRel = top[1]?.relevance ?? 0;
  const scoreMargin = Number((topRel - secondRel).toFixed(4));
  const confidence = computeConfidence({
    hasResults: chunks.length > 0,
    topRelevance: topRel,
    margin: scoreMargin,
    coverageCount: chunks.length,
    semantic: provider.semantic && usedVector,
    agreement: usedVector ? overlap(lexical, vector) : 0,
  });

  const diagnostics: RetrievalDiagnostics = {
    lexicalCandidates: lexical.length,
    vectorCandidates: vector.length,
    fusedCandidates: fused.size,
    returned: chunks.length,
    embeddingProvider: provider.meta.provider,
    semanticEmbeddings: provider.semantic,
    reranker: reranker.name,
    fusion: usedVector ? "rrf-hybrid" : "lexical-only",
    rerankMovement,
    topScore: Number(topRel.toFixed(4)),
    scoreMargin,
    latencyMs: Date.now() - startedAt,
  };

  return {
    chunks,
    citations,
    confidence: Number(confidence.toFixed(3)),
    confidenceLabel: confidence >= 0.66 ? "high" : confidence >= 0.4 ? "medium" : "low",
    diagnostics,
  };
}

// Fraction of the top lexical results that also appear in the vector results —
// a proxy for "the two retrieval signals agree", which raises confidence.
function overlap(lex: RetrievedChunk[], vec: { chunk: RetrievedChunk }[]): number {
  if (!lex.length || !vec.length) return 0;
  const vecIds = new Set(vec.map((v) => v.chunk.id));
  const topLex = lex.slice(0, 5);
  const shared = topLex.filter((c) => vecIds.has(c.id)).length;
  return shared / topLex.length;
}

interface ConfidenceInputs {
  hasResults: boolean;
  topRelevance: number; // [0,1]
  margin: number; // separation between top1 and top2
  coverageCount: number; // how many sources returned
  semantic: boolean; // true semantic embeddings used
  agreement: number; // lexical/vector agreement [0,1]
}

// Weighted blend of independent trust signals, clamped to [0,1].
export function computeConfidence(i: ConfidenceInputs): number {
  if (!i.hasResults) return 0;
  const relevance = clamp01(i.topRelevance) * 0.45;
  const separation = clamp01(i.margin * 2) * 0.15;
  const coverage = clamp01(i.coverageCount / 4) * 0.15;
  const semanticBonus = (i.semantic ? 1 : 0.55) * 0.15; // lexical-only caps lower
  const agreement = clamp01(i.agreement) * 0.1;
  return clamp01(relevance + separation + coverage + semanticBonus + agreement);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
