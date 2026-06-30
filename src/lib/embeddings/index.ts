// Embedding provider abstraction.
//
// The rest of the app depends ONLY on the `EmbeddingProvider` interface and the
// `getEmbeddingProvider()` factory — never on a concrete vendor. To swap
// providers (OpenAI → Voyage → a local model) you implement the interface and
// change the factory; application code is untouched.
//
// Every embedding we persist is tagged with `{ model, version, dim }` so a
// future re-indexing job can detect vectors produced by an older model and
// recompute them. Heavy semantic-search usage lands in Slice 2; this scaffold
// ships now so the contract is stable.

export interface EmbeddingMeta {
  /** Provider identifier, e.g. "openai" or "keyword-fallback". */
  provider: string;
  /** Model name, e.g. "text-embedding-3-small". */
  model: string;
  /** Monotonic version for re-indexing decisions. Bump when model/params change. */
  version: number;
  /** Vector dimensionality. */
  dim: number;
}

export interface EmbeddingResult {
  vector: number[];
  meta: EmbeddingMeta;
}

export interface EmbeddingProvider {
  readonly meta: Omit<EmbeddingMeta, "dim"> & { dim: number };
  /** True when this provider produces real semantic vectors (vs. the fallback). */
  readonly semantic: boolean;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}

// ───────────────────────── OpenAI-compatible provider ─────────────────────────

const OPENAI_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const OPENAI_DIM = Number(process.env.EMBEDDING_DIM ?? 1536);
const EMBEDDING_VERSION = Number(process.env.EMBEDDING_VERSION ?? 1);

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly semantic = true;
  readonly meta = {
    provider: "openai",
    model: OPENAI_MODEL,
    version: EMBEDDING_VERSION,
    dim: OPENAI_DIM,
  };
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const [r] = await this.embedBatch([text]);
    return r;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.meta.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => ({
      vector: d.embedding,
      meta: { ...this.meta, dim: d.embedding.length },
    }));
  }
}

// ───────────────────────── Keyword fallback provider ─────────────────────────
// Deterministic, dependency-free hashing embedding. Not semantic, but lets the
// pipeline (store vectors, run cosine similarity) work end-to-end with zero
// secrets so the product is fully functional in demo/offline mode. Tagged with a
// distinct provider name so a re-index can upgrade these once a real key exists.

const FALLBACK_DIM = 256;

function fallbackVector(text: string): number[] {
  const v = new Array(FALLBACK_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % FALLBACK_DIM;
    v[idx] += 1;
  }
  // L2 normalize so cosine similarity is meaningful.
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

class KeywordFallbackProvider implements EmbeddingProvider {
  readonly semantic = false;
  readonly meta = {
    provider: "keyword-fallback",
    model: "hashing-bow",
    version: EMBEDDING_VERSION,
    dim: FALLBACK_DIM,
  };
  async embed(text: string): Promise<EmbeddingResult> {
    return { vector: fallbackVector(text), meta: { ...this.meta } };
  }
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return texts.map((t) => ({ vector: fallbackVector(t), meta: { ...this.meta } }));
  }
}

// ───────────────────────── Factory ─────────────────────────

let cached: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl =
    process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1";
  // Allow forcing the fallback (tests / offline demos) via env.
  const forceFallback = process.env.EMBEDDINGS_DISABLED === "1";
  if (apiKey && !forceFallback) {
    cached = new OpenAIEmbeddingProvider(apiKey, baseUrl);
  } else {
    cached = new KeywordFallbackProvider();
  }
  return cached;
}

/** Reset the cached provider (used by tests that toggle env). */
export function __resetEmbeddingProvider(): void {
  cached = null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
