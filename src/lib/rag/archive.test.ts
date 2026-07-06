import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL so this exercises the real SQL path. Set BEFORE importing db.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { retrieve } from "./retrieve";
import { listDocuments } from "@/lib/queries";

const ORG = "org_arch";

async function addDoc(id: string, filename: string, content: string, archivedAt: number | null) {
  await db.insert(documents).values({
    id,
    orgId: ORG,
    filename,
    kind: "manual",
    processingStatus: "ready",
    archivedAt: archivedAt ? new Date(archivedAt) : null,
  });
  await db.insert(chunks).values({
    id: `${id}_c0`,
    orgId: ORG,
    documentId: id,
    ordinal: 0,
    content,
  });
}

beforeAll(async () => {
  await ensureDb();
  await addDoc("doc_live", "powerflex_manual.pdf", "PowerFlex F007 motor overload thermal fault clear reset", null);
  await addDoc("doc_test", "test_upload_audit.pdf", "PowerFlex F007 motor overload thermal fault clear reset", Date.now());
});

describe("archived documents are hidden", () => {
  it("listDocuments excludes archived docs", async () => {
    const docs = await listDocuments(ORG);
    const names = docs.map((d) => d.filename);
    expect(names).toContain("powerflex_manual.pdf");
    expect(names).not.toContain("test_upload_audit.pdf");
  });

  it("retrieval never returns an archived doc's chunks (never cited)", async () => {
    const hits = await retrieve("powerflex f007 motor overload thermal", { orgId: ORG, limit: 10 });
    const docIds = hits.map((h) => h.documentId);
    expect(docIds).toContain("doc_live");
    expect(docIds).not.toContain("doc_test");
  });
});
