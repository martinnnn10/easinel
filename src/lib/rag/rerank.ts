import type { RetrievedChunk } from "./retrieve";

// Reranking abstraction. A reranker re-orders fused candidates by deep relevance
// to the query. The production path can call a cross-encoder/relevance API; the
// always-on baseline is a deterministic lexical-overlap reranker so the feature
// works with zero secrets and never blocks an answer.

export interface RerankResult {
  chunk: RetrievedChunk;
  /** Reranker relevance score in [0,1]. */
  relevance: number;
  /** Rank delta vs. the pre-rerank order (positive = moved up). */
  delta: number;
}

export interface Reranker {
  readonly name: string;
  readonly semantic: boolean;
  rerank(query: string, candidates: RetrievedChunk[]): Promise<RerankResult[]>;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "is", "are", "for",
  "with", "this", "that", "it", "be", "as", "at", "by", "from",
]);

function terms(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOP.has(t)
  );
}

// Deterministic reranker: scores each candidate by query-term coverage and
// density within the chunk, with a mild bonus for term proximity. Cheap, stable,
// and a genuine quality lift over raw fusion order for short technical queries.
export class LexicalReranker implements Reranker {
  readonly name = "lexical-overlap";
  readonly semantic = false;

  async rerank(query: string, candidates: RetrievedChunk[]): Promise<RerankResult[]> {
    const q = terms(query);
    const qset = new Set(q);
    if (!qset.size) {
      return candidates.map((c, i) => ({ chunk: c, relevance: 0, delta: 0 }));
    }

    const scored = candidates.map((c, originalIndex) => {
      const toks = terms(c.content);
      if (!toks.length) return { c, originalIndex, score: 0 };
      let hits = 0;
      const seen = new Set<string>();
      const positions: number[] = [];
      toks.forEach((t, i) => {
        if (qset.has(t)) {
          hits++;
          seen.add(t);
          positions.push(i);
        }
      });
      const coverage = seen.size / qset.size; // how many distinct query terms appear
      const density = hits / Math.sqrt(toks.length); // frequency, length-normalized
      // Proximity: tighter clusters of query terms score higher.
      let proximity = 0;
      if (positions.length > 1) {
        const span = positions[positions.length - 1] - positions[0] + 1;
        proximity = positions.length / span; // 1.0 when contiguous
      }
      const score = coverage * 0.6 + Math.min(density, 1) * 0.3 + proximity * 0.1;
      return { c, originalIndex, score };
    });

    const max = Math.max(...scored.map((s) => s.score), 1e-9);
    const ranked = [...scored]
      .map((s) => ({ ...s, relevance: s.score / max }))
      .sort((a, b) => b.relevance - a.relevance);

    return ranked.map((s, newIndex) => ({
      chunk: s.c,
      relevance: Number(s.relevance.toFixed(4)),
      delta: s.originalIndex - newIndex,
    }));
  }
}

export function getReranker(): Reranker {
  // Hook point: when a rerank API key exists, return a semantic reranker here.
  // The deterministic reranker is the always-on baseline.
  return new LexicalReranker();
}
