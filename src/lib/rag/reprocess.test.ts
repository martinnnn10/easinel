import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL exercises the real SQL path. Set BEFORE importing db.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { reprocessDocument } from "./ingest";

const ORG = "org_reproc";

beforeAll(async () => {
  await ensureDb();
  // A document with no stored original (text was indexed directly).
  await db.insert(documents).values({
    id: "doc_noorig",
    orgId: ORG,
    filename: "pasted_notes.txt",
    kind: "document",
    storagePath: null,
    charCount: 0,
    processingStatus: "failed",
  });
});

describe("reprocessDocument guards", () => {
  it("is tenant-scoped — another org can't reprocess this doc", async () => {
    const r = await reprocessDocument("org_other", "doc_noorig");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("not_found");
  });

  it("reports honestly when there is no stored original to re-extract", async () => {
    const r = await reprocessDocument(ORG, "doc_noorig");
    expect(r.ok).toBe(false);
    expect(r.status).toBe("no_original");
  });

  it("returns not_found for an unknown document id", async () => {
    const r = await reprocessDocument(ORG, "doc_missing");
    expect(r.status).toBe("not_found");
  });
});
