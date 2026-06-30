import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  hasLiveProvider,
  getLiveChatProvider,
  getFallbackChatProvider,
} from "./providers";
import { LexicalReranker } from "@/lib/rag/rerank";
import { computeConfidence } from "@/lib/rag/hybrid";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

// These tests prove the AI architecture's CONTRACTS independent of any API key:
//   • provider auto-selection (key present vs. absent, and AI_DISABLED override)
//   • deterministic fallback streams a real answer through the same interface
//   • reranker reorders by relevance and reports rank deltas
//   • confidence scoring is a real monotonic signal, not a constant

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "AI_CHAT_API_KEY",
  "OPENAI_API_KEY",
  "AI_DISABLED",
];

describe("LLM provider abstraction", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports no live provider and returns null when no key is configured", () => {
    expect(hasLiveProvider()).toBe(false);
    expect(getLiveChatProvider()).toBeNull();
  });

  it("selects Anthropic when ANTHROPIC_API_KEY is present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(hasLiveProvider()).toBe(true);
    const p = getLiveChatProvider();
    expect(p?.meta.provider).toBe("anthropic");
    expect(p?.meta.live).toBe(true);
  });

  it("selects OpenAI-compatible when only OPENAI_API_KEY is present", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const p = getLiveChatProvider();
    expect(p?.meta.provider).toBe("openai");
  });

  it("AI_DISABLED=1 forces the fallback even with a key present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AI_DISABLED = "1";
    expect(hasLiveProvider()).toBe(false);
    expect(getLiveChatProvider()).toBeNull();
  });

  it("fallback provider streams the precomputed answer verbatim", async () => {
    const provider = getFallbackChatProvider("## Problem Summary\nDo LOTO first.");
    expect(provider.meta.live).toBe(false);
    let out = "";
    for await (const d of provider.stream({ system: "", messages: [] })) out += d;
    expect(out).toBe("## Problem Summary\nDo LOTO first.");
  });
});

describe("Lexical reranker", () => {
  const mk = (id: string, content: string): RetrievedChunk => ({
    id,
    documentId: "d_" + id,
    filename: id + ".md",
    kind: "manual",
    ordinal: 0,
    content,
    score: 0,
  });

  it("ranks the most query-relevant chunk first and reports deltas", async () => {
    const reranker = new LexicalReranker();
    const candidates = [
      mk("a", "general safety notes about the plant cafeteria and parking"),
      mk("b", "PowerFlex 525 fault F007 motor overload thermal trip after warmup"),
      mk("c", "centrifugal pump seal weeping vibration"),
    ];
    const ranked = await reranker.rerank("powerflex f007 motor overload", candidates);
    expect(ranked[0].chunk.id).toBe("b");
    expect(ranked[0].relevance).toBeGreaterThan(ranked[1].relevance);
    // chunk b moved from index 1 to index 0 → positive delta
    const b = ranked.find((r) => r.chunk.id === "b")!;
    expect(b.delta).toBeGreaterThan(0);
  });

  it("returns zero relevance gracefully for an empty query", async () => {
    const reranker = new LexicalReranker();
    const ranked = await reranker.rerank("", [mk("a", "anything")]);
    expect(ranked[0].relevance).toBe(0);
  });
});

describe("Confidence scoring", () => {
  it("is zero when there are no results", () => {
    expect(
      computeConfidence({
        hasResults: false,
        topRelevance: 0,
        margin: 0,
        coverageCount: 0,
        semantic: false,
        agreement: 0,
      })
    ).toBe(0);
  });

  it("rises with relevance, margin, coverage, semantic embeddings, and agreement", () => {
    const low = computeConfidence({
      hasResults: true,
      topRelevance: 0.3,
      margin: 0.02,
      coverageCount: 1,
      semantic: false,
      agreement: 0,
    });
    const high = computeConfidence({
      hasResults: true,
      topRelevance: 0.95,
      margin: 0.4,
      coverageCount: 4,
      semantic: true,
      agreement: 1,
    });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
    expect(low).toBeGreaterThan(0);
  });

  it("caps lexical-only answers below a perfect score", () => {
    const lexicalOnly = computeConfidence({
      hasResults: true,
      topRelevance: 1,
      margin: 1,
      coverageCount: 4,
      semantic: false,
      agreement: 0,
    });
    // semanticBonus contributes 0.55*0.15 instead of 1*0.15, and agreement 0.
    expect(lexicalOnly).toBeLessThan(1);
  });
});
