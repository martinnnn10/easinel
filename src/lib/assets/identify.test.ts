import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL, no live AI provider — the photo path must degrade honestly
// (never invent identity) and the typed path must resolve to existing assets.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

import { identifyMachine } from "./identify";
import { createAsset, listAssets } from "./repository";

const ORG = "org_identify_test";

describe("machine identify (asset-first entry)", () => {
  beforeAll(async () => {
    await listAssets(ORG); // ensure schema
    await createAsset(
      ORG,
      { name: "Line 3 Case Packer", assetTag: "CP-031", manufacturer: "Allen-Bradley", model: "PF525", serialNumber: "1P5C25A103", assetType: "packaging" },
      "tester"
    );
  });

  it("matches an existing machine by serial number", async () => {
    const r = await identifyMachine(ORG, { serialNumber: "1P5C25A103" });
    expect(r.bestMatch).not.toBeNull();
    expect(r.bestMatch!.asset.assetTag).toBe("CP-031");
    expect(r.method).toBe("typed");
  });

  it("surfaces candidates by model and offers a new-asset draft", async () => {
    const r = await identifyMachine(ORG, { manufacturer: "Allen-Bradley", model: "PF525" });
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
    expect(r.newAssetDraft.name).toContain("Allen-Bradley");
    expect(r.suggestedNumber).toBeTruthy();
  });

  it("returns no match (and a create-it note) for an unknown machine", async () => {
    const r = await identifyMachine(ORG, { manufacturer: "SEW", model: "ZZ-NOPE-999" });
    expect(r.bestMatch).toBeNull();
    expect(r.note).toMatch(/create/i);
  });

  it("degrades honestly when a photo is supplied but no vision model is live", async () => {
    const r = await identifyMachine(ORG, {
      image: { mediaType: "image/png", dataBase64: "iVBORw0KGgo=" },
    });
    // No live vision provider → no invented identity, and an actionable note.
    expect(r.identity.manufacturer).toBeNull();
    expect(r.identity.model).toBeNull();
    expect(r.note).toMatch(/vision|type the asset/i);
  });
});
