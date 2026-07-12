import { describe, it, expect } from "vitest";
import { citationsUsedInAnswer } from "./events";

// Fix 7 — Citation honesty. Retrieving a chunk is NOT citing it. Only a citation
// whose marker actually appears in the finished answer text counts as "used", so
// the reuse metric / KRI / Reuse Impact can never overcount retrieval.

type C = { marker: number | null; documentId: string; filename?: string };
const cite = (marker: number | null, documentId: string): C => ({ marker, documentId, filename: documentId });

describe("citationsUsedInAnswer", () => {
  it("counts only citations whose marker appears in the answer", () => {
    const citations = [cite(1, "docA"), cite(2, "docB"), cite(3, "docC")];
    const answer = "Check the drive fault [1]. See also the manual [3].";
    const used = citationsUsedInAnswer(citations, answer);
    expect(used.map((c) => c.documentId).sort()).toEqual(["docA", "docC"]);
  });

  it("counts nothing when the answer cites nothing (retrieved-but-unused)", () => {
    const citations = [cite(1, "docA"), cite(2, "docB")];
    const answer = "The motor was replaced and the line restarted."; // no [n] markers
    expect(citationsUsedInAnswer(citations, answer)).toEqual([]);
  });

  it("ignores citations with a null marker even if a stray bracket exists", () => {
    const citations = [cite(null, "docA")];
    expect(citationsUsedInAnswer(citations, "answer with [1] marker")).toEqual([]);
  });

  it("is empty for an empty answer or empty citations", () => {
    expect(citationsUsedInAnswer([cite(1, "docA")], "")).toEqual([]);
    expect(citationsUsedInAnswer([], "uses [1]")).toEqual([]);
  });

  it("does not confuse [1] with [10] — the bracketed marker is an exact token", () => {
    const citations = [cite(1, "docOne"), cite(10, "docTen")];
    // Answer cites only [10]. "[10]" does NOT contain the substring "[1]" (the
    // closing bracket after 1 is required), so docOne must NOT be counted.
    const answer = "Only the tenth source is used [10].";
    const used = citationsUsedInAnswer(citations, answer).map((c) => c.documentId);
    expect(used).toEqual(["docTen"]);
  });
});
