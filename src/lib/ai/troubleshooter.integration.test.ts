import { describe, it, expect, beforeAll } from "vitest";
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";
delete process.env.ANTHROPIC_API_KEY; // force the offline grounded engine

import { db, ensureDb } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { chunkText } from "@/lib/rag/chunk";
import { answerOnce } from "./chat";
import { id } from "@/lib/util";

const ORG = "org_ts_test";

// A realistic, CHOPPY installation-manual extract (one token/label per line, the
// way a real PDF like 5370.pdf comes out) that DOES contain the RTD answer.
const DOC_TEXT = `VIKING MASEK GLOBAL
PACKAGING TECHNOLOGIES
5370
ZONE 3 HEATER
RTD SENSOR WIRING
IF THE RTD IS OPEN OR BROKEN THE TEMPERATURE INPUT WILL FAULT AND DISPLAY OVERRANGE.
CHECK THE RTD WIRING AT THE TERMINAL BLOCK AND MEASURE THE RESISTANCE OF THE ELEMENT.
A GOOD PT100 READS ABOUT 100 OHMS AT 0 DEGREES C.
IF THE READING IS OPEN, REPLACE THE RTD SENSOR.`;

async function seedDoc() {
  const docId = id("doc");
  await db.insert(documents).values({
    id: docId,
    orgId: ORG,
    assetId: null,
    filename: "5370 (1).pdf",
    kind: "document",
    mimeType: "application/pdf",
    sizeBytes: DOC_TEXT.length,
    charCount: DOC_TEXT.length,
    storagePath: null,
  });
  let ord = 0;
  for (const piece of chunkText(DOC_TEXT)) {
    await db.insert(chunks).values({
      id: id("chk"),
      orgId: ORG,
      documentId: docId,
      assetId: null,
      ordinal: ord++,
      content: piece,
    });
  }
}

describe("AI troubleshooter (offline) reads an uploaded PDF end-to-end", () => {
  beforeAll(async () => {
    await ensureDb();
    await seedDoc();
  });

  it("answers an RTD fault question with content pulled from the uploaded document", async () => {
    const r = await answerOnce({
      orgId: ORG,
      question: "my rtd is faulted out what do i do",
    });
    expect(r.live).toBe(false); // offline grounded engine
    // It must actually retrieve the uploaded doc as a source.
    expect(r.sources.some((s) => s.filename === "5370 (1).pdf")).toBe(true);
    // And the ANSWER must contain the document's own guidance — not a template.
    const a = r.answer.toLowerCase();
    expect(a).toContain("what your documents say");
    expect(a).toMatch(/rtd/);
    expect(a).toMatch(/open|overrange|terminal|resistance|pt100/);
    expect(a).not.toContain("most likely failure mode for this symptom");
  }, 20000);

  it("cites the uploaded document as a source", async () => {
    const r = await answerOnce({ orgId: ORG, question: "rtd open circuit overrange fault" });
    expect(r.citations.some((c) => c.filename === "5370 (1).pdf")).toBe(true);
  }, 20000);
});
