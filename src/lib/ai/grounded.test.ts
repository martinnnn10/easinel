import { describe, it, expect } from "vitest";
import { extractRelevantPassages, hasRelevantContent, buildGroundedFromDocuments } from "./grounded";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

function chunk(partial: Partial<RetrievedChunk> & { content: string; filename: string }): RetrievedChunk {
  return {
    id: partial.id ?? "c1",
    documentId: partial.documentId ?? "d1",
    filename: partial.filename,
    kind: partial.kind ?? "document",
    ordinal: partial.ordinal ?? 0,
    content: partial.content,
    score: partial.score ?? 1,
  };
}

describe("offline grounded synthesis (reads the retrieved documents)", () => {
  const rtdDocs: RetrievedChunk[] = [
    chunk({
      filename: "5370.pdf",
      content:
        "RTD input channel fault. An open RTD circuit — a broken lead or a loose terminal — drives the channel to its over-range fault state. Check the resistance across the element: a Pt100 reads about 100 ohms at 0 C. Verify the wiring lands on the correct module channel.",
    }),
    chunk({
      filename: "5370.pdf",
      ordinal: 1,
      content:
        "General safety: lockout tagout the panel before servicing. Torque all field terminals to specification.",
    }),
  ];

  it("surfaces the passages that actually answer the question, with source markers", () => {
    const passages = extractRelevantPassages("my rtd is faulted out what do i do", rtdDocs);
    expect(passages.length).toBeGreaterThan(0);
    // The top passage must mention the RTD fault content from the document.
    expect(passages[0].text.toLowerCase()).toMatch(/rtd|open|element|channel/);
    expect(passages[0].filename).toBe("5370.pdf");
    expect(passages[0].marker).toBeGreaterThanOrEqual(1);
  });

  it("builds an answer that QUOTES the document instead of a generic template", () => {
    const answer = buildGroundedFromDocuments("rtd faulted out", rtdDocs);
    expect(answer).toContain("What Your Documents Say");
    // The literal document wording must appear in the answer body (grounded, not templated).
    expect(answer.toLowerCase()).toContain("open rtd circuit");
    expect(answer).toContain("[1]"); // cites the first source
    expect(answer).toContain("5370.pdf");
    // Must NOT fall back to the placeholder generic table.
    expect(answer).not.toContain("Most likely failure mode for this symptom");
  });

  it("returns empty (caller falls back) when nothing in the docs is relevant", () => {
    const irrelevant: RetrievedChunk[] = [
      chunk({ filename: "hydraulics.pdf", content: "The hydraulic accumulator should be pre-charged with nitrogen to 1000 psi before startup." }),
    ];
    expect(hasRelevantContent("why is my rtd faulted", irrelevant)).toBe(false);
    expect(buildGroundedFromDocuments("why is my rtd faulted", irrelevant)).toBe("");
  });

  it("recovers content from CHOPPY PDF text (one token/label per line, like 5370.pdf)", () => {
    // Mimics how a real installation-manual PDF extracts: labels and words each
    // on their own line, so naive newline-splitting would shred the RTD note.
    const choppy: RetrievedChunk[] = [
      chunk({
        filename: "5370 (1).pdf",
        content:
          "VIKING MASEK GLOBAL\nPACKAGING TECHNOLOGIES\nCOVER PAGE\n5370\nZONE\n3\nHEATER\nRTD\nSENSOR\nWIRING\nIF\nTHE\nRTD\nIS\nOPEN\nOR\nBROKEN\nTHE\nTEMPERATURE\nINPUT\nWILL\nFAULT\nAND\nDISPLAY\nOVERRANGE\nCHECK\nTHE\nWIRING\nAT\nTHE\nTERMINAL\nBLOCK",
      }),
    ];
    const passages = extractRelevantPassages("my rtd is faulted out what do i do", choppy);
    expect(passages.length).toBeGreaterThan(0);
    const joined = passages.map((p) => p.text.toLowerCase()).join(" ");
    // The windowed extractor must rejoin the split-across-lines RTD guidance.
    expect(joined).toMatch(/rtd/);
    expect(joined).toMatch(/open|broken|fault|overrange|wiring/);
    expect(passages[0].filename).toBe("5370 (1).pdf");
  });

  it("does not leak an unrelated topic as a match (comms vs temperature)", () => {
    const commsDoc: RetrievedChunk[] = [
      chunk({ filename: "net.pdf", content: "F081 loss of communications. Reseat the EtherNet cable and verify the scanner is in RUN." }),
    ];
    // An RTD question should not surface the comms passage.
    expect(hasRelevantContent("rtd temperature sensor open circuit", commsDoc)).toBe(false);
  });
});
