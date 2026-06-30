import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getEmbeddingProvider,
  __resetEmbeddingProvider,
  cosineSimilarity,
} from "./index";

describe("embedding provider", () => {
  const original = { ...process.env };
  beforeEach(() => __resetEmbeddingProvider());
  afterEach(() => {
    process.env = { ...original };
    __resetEmbeddingProvider();
  });

  it("falls back to keyword provider when no API key is present", () => {
    delete process.env.OPENAI_API_KEY;
    const p = getEmbeddingProvider();
    expect(p.semantic).toBe(false);
    expect(p.meta.provider).toBe("keyword-fallback");
  });

  it("uses the OpenAI provider when a key is present and not disabled", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.EMBEDDINGS_DISABLED;
    const p = getEmbeddingProvider();
    expect(p.semantic).toBe(true);
    expect(p.meta.provider).toBe("openai");
  });

  it("honors EMBEDDINGS_DISABLED to force the fallback", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.EMBEDDINGS_DISABLED = "1";
    const p = getEmbeddingProvider();
    expect(p.semantic).toBe(false);
  });

  it("keyword fallback is deterministic and L2-normalized", async () => {
    delete process.env.OPENAI_API_KEY;
    const p = getEmbeddingProvider();
    const a = await p.embed("conveyor overload fault F007");
    const b = await p.embed("conveyor overload fault F007");
    expect(a.vector).toEqual(b.vector);
    const norm = Math.sqrt(a.vector.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
    // identical text → cosine 1; tags re-indexable via meta
    expect(cosineSimilarity(a.vector, b.vector)).toBeCloseTo(1, 5);
    expect(a.meta.model).toBe("hashing-bow");
  });

  it("similar text scores higher than unrelated text", async () => {
    delete process.env.OPENAI_API_KEY;
    const p = getEmbeddingProvider();
    const base = (await p.embed("motor overload after twenty minutes")).vector;
    const near = (await p.embed("motor overload after twenty minutes of run")).vector;
    const far = (await p.embed("network switch firmware upgrade")).vector;
    expect(cosineSimilarity(base, near)).toBeGreaterThan(cosineSimilarity(base, far));
  });
});
