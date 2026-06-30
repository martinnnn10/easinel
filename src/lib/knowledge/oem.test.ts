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

  it("grounds a safety-circuit question without ever telling anyone to bypass it", async () => {
    const hits = await retrieve("safety relay won't reset light curtain e-stop", { orgId: ORG, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.content.toLowerCase()).join(" ");
    expect(joined).toContain("safety");
    // The reference must never instruct defeating a safety device.
    expect(joined).not.toMatch(/jumper the (e-stop|safety)|bypass the (light curtain|safety device) to run/);
  });

  it("answers a PLC comm/controller-fault question on day one", async () => {
    const hits = await retrieve("plc controller faulted ethernet module comm loss", { orgId: ORG, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.content.toLowerCase()).join(" ");
    expect(joined).toMatch(/controller|i\/o|comm/);
  });

  it("answers a discrete-sensor 'random misses' question", async () => {
    const hits = await retrieve("photoeye randomly missing parts not detecting", { orgId: ORG, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const joined = hits.map((h) => h.content.toLowerCase()).join(" ");
    expect(joined).toMatch(/lens|sensor|align/);
  });

  it("ships a non-trivial reference library spanning common equipment classes", () => {
    expect(OEM_KNOWLEDGE.length).toBeGreaterThanOrEqual(10);
    // Every reference must carry an equipment class label (shown to the technician)
    // and stay honest about being a general reference, not the machine's own manual.
    for (const doc of OEM_KNOWLEDGE) {
      expect(doc.equipmentClass.length).toBeGreaterThan(0);
      expect(doc.text.toLowerCase()).toMatch(/general|generic/);
    }
    // Reference ids must be unique (idempotent per-document seeding relies on this).
    expect(new Set(OEM_KNOWLEDGE.map((d) => d.id)).size).toBe(OEM_KNOWLEDGE.length);
  });
});
