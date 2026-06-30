import { describe, it, expect, beforeAll } from "vitest";
// In-memory libSQL; keyword-fallback embeddings so the vector path runs with no
// secrets (deterministic). MUST be set before importing the db module.
process.env.DATABASE_URL = ":memory:";
// Force the deterministic keyword-fallback embeddings so the vector path runs
// hermetically (no network, no API key). The fallback still produces real
// L2-normalized vectors, so rrf-hybrid fusion is genuinely exercised.
process.env.EMBEDDINGS_DISABLED = "1";
import { db, ensureDb } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { GLOBAL_ORG } from "@/lib/util";
import { hybridRetrieve } from "./hybrid";

const ORG_A = "org_hybrid_a";
const ORG_B = "org_hybrid_b";

async function seedChunk(
  orgId: string,
  docId: string,
  chunkId: string,
  filename: string,
  kind: string,
  content: string
) {
  await db
    .insert(documents)
    .values({ id: docId, orgId, filename, kind, charCount: content.length })
    .onConflictDoNothing();
  const vec = (await getEmbeddingProvider().embed(content)).vector;
  await db
    .insert(chunks)
    .values({
      id: chunkId,
      orgId,
      documentId: docId,
      assetId: null,
      ordinal: 0,
      content,
      embedding: JSON.stringify(vec),
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  await ensureDb();
  await seedChunk(
    ORG_A,
    "doc_a1",
    "chk_a1",
    "ConveyorManual.md",
    "manual",
    "PowerFlex 525 fault F007 is a motor overload caused by thermal buildup; do not raise the overload limit P034 to mask it."
  );
  await seedChunk(
    ORG_A,
    "doc_a2",
    "chk_a2",
    "Cafeteria.md",
    "document",
    "The plant cafeteria serves lunch from 11 to 1 and parking is on the north lot."
  );
  await seedChunk(
    ORG_B,
    "doc_b1",
    "chk_b1",
    "SecretBravo.md",
    "manual",
    "Org B confidential: PowerFlex 525 fault F007 motor overload on Line 9 packaging robot."
  );
  await seedChunk(
    GLOBAL_ORG,
    "doc_g1",
    "chk_g1",
    "OEM-VFD.md",
    "oem_reference",
    "General VFD reference: an overload fault that appears only after warmup is a thermal or mechanical signature."
  );
});

describe("hybrid retrieval", () => {
  it("returns relevant chunks with fused scores, citations, confidence, diagnostics", async () => {
    const r = await hybridRetrieve("powerflex f007 motor overload", { orgId: ORG_A, limit: 5 });
    expect(r.chunks.length).toBeGreaterThan(0);
    // the relevant manual should rank above the cafeteria noise
    expect(r.chunks[0].filename).toBe("ConveyorManual.md");
    // citations carry sequential markers starting at 1, mapped to the chunks
    expect(r.citations[0].marker).toBe(1);
    expect(r.citations[0].filename).toBe("ConveyorManual.md");
    // confidence is a real number in (0,1]
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    // diagnostics report the fusion + reranker used
    expect(["rrf-hybrid", "lexical-only"]).toContain(r.diagnostics.fusion);
    expect(r.diagnostics.reranker).toBe("lexical-overlap");
    expect(r.diagnostics.returned).toBe(r.chunks.length);
  });

  it("uses the vector path when embeddings exist (rrf-hybrid fusion)", async () => {
    const r = await hybridRetrieve("overload fault after warmup thermal", { orgId: ORG_A, limit: 5 });
    expect(r.diagnostics.vectorCandidates).toBeGreaterThan(0);
    expect(r.diagnostics.fusion).toBe("rrf-hybrid");
  });

  it("includes shared GLOBAL OEM knowledge but NEVER another tenant's private docs", async () => {
    const r = await hybridRetrieve("powerflex f007 motor overload", { orgId: ORG_A, limit: 10 });
    const files = r.chunks.map((c) => c.filename);
    // global OEM reference is visible to every tenant
    expect(files).toContain("OEM-VFD.md");
    // Org B's confidential doc must NEVER appear for Org A
    expect(files).not.toContain("SecretBravo.md");
  });

  it("is symmetric: Org B cannot see Org A's private docs", async () => {
    const r = await hybridRetrieve("powerflex f007 motor overload", { orgId: ORG_B, limit: 10 });
    const files = r.chunks.map((c) => c.filename);
    expect(files).toContain("SecretBravo.md");
    expect(files).not.toContain("ConveyorManual.md");
    expect(files).not.toContain("Cafeteria.md");
  });

  it("requires an orgId (hard error)", async () => {
    await expect(
      // @ts-expect-error intentionally omitting orgId
      hybridRetrieve("anything", { limit: 3 })
    ).rejects.toThrow(/orgId/);
  });
});
