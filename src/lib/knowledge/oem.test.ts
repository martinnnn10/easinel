import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { seedOemKnowledge, OEM_KNOWLEDGE } from "./oem";
import { retrieve } from "@/lib/rag/retrieve";
const ORG = "org_test";

describe("pre-seeded OEM knowledge (Decision 4: day-one value)", () => {
  beforeAll(async () => {
    await seedOemKnowledge();
    await seedOemKnowledge(); // idempotent: second call must not duplicate
  });

  it("answers a PowerFlex fault question with zero customer uploads", async () => {
    const hits = await retrieve("PowerFlex 525 fault F081 comm loss", { orgId: ORG, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.content.toLowerCase()).join(" ");
    expect(joined).toContain("f081");
  });

  it("provides a general VFD diagnostic approach for any brand", async () => {
    const hits = await retrieve("vfd drive overload after it warms up", { orgId: ORG, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("seeds the references as org-global (retrievable without an asset scope)", async () => {
    const hits = await retrieve("centrifugal pump cavitation suction strainer", { orgId: ORG, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.content.toLowerCase()).join(" ");
    expect(joined).toContain("cavitation");
  });

  it("ships a non-trivial reference library", () => {
    expect(OEM_KNOWLEDGE.length).toBeGreaterThanOrEqual(4);
  });
});
