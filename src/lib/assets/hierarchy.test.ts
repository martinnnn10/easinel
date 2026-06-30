import { describe, it, expect, beforeAll } from "vitest";
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

import {
  createAsset,
  listAssets,
  listChildren,
  getAncestors,
} from "./repository";
import { suggestAssetNumber, resolveAssetForGeneration } from "./assign";

const ORG = "org_hier_test";
const OTHER = "org_hier_other";

describe("Asset parent-child hierarchy", () => {
  beforeAll(async () => {
    await listAssets(ORG, {}); // ensure schema
  });

  it("links children to a parent and resolves the ancestor chain", async () => {
    const site = await createAsset(ORG, { name: "Plant 1", assetLevel: "site" }, "t");
    const line = await createAsset(
      ORG,
      { name: "Line A", parentAssetId: site.id, assetLevel: "line" },
      "t"
    );
    const machine = await createAsset(
      ORG,
      { name: "Conveyor 3", parentAssetId: line.id, assetLevel: "machine", assetType: "conveyor" },
      "t"
    );
    const component = await createAsset(
      ORG,
      { name: "Drive Gearbox", parentAssetId: machine.id, assetLevel: "component", assetType: "gearbox" },
      "t"
    );

    // Children of the line should include the machine.
    const lineChildren = await listChildren(ORG, line.id);
    expect(lineChildren.map((c) => c.id)).toContain(machine.id);

    // Ancestors of the component: machine → line → site (immediate-first).
    const chain = await getAncestors(ORG, component.id);
    expect(chain.map((a) => a.name)).toEqual(["Conveyor 3", "Line A", "Plant 1"]);
  });

  it("guards against a parent cycle", async () => {
    const a = await createAsset(ORG, { name: "Cyc A" }, "t");
    const b = await createAsset(ORG, { name: "Cyc B", parentAssetId: a.id }, "t");
    // Force a cycle: make A's parent B.
    const { updateAsset } = await import("./repository");
    await updateAsset(ORG, a.id, { parentAssetId: b.id }, "t");
    const chain = await getAncestors(ORG, a.id);
    // Should terminate (no infinite loop) and not contain duplicates.
    const ids = chain.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(chain.length).toBeLessThanOrEqual(20);
  });
});

describe("Asset-number suggestion (SITE-LINE-MACHINE-SEQUENCE)", () => {
  // Unique per run so a leftover row in the shared in-memory DB (vitest reuses
  // the libSQL singleton across files) can never make the sequence start at -002.
  const NUM_ORG = `org_hier_numbering_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  it("builds a structured, collision-safe, editable tag", async () => {
    const first = await suggestAssetNumber(NUM_ORG, {
      site: "Plant 1",
      line: "Line A",
      assetType: "conveyor",
    });
    expect(first.suggestion).toBe("PLANT-LINEA-CONV-001");
    expect(first.prefix).toBe("PLANT-LINEA-CONV");

    // Create an asset that takes -001, then the next suggestion must skip to -002.
    await createAsset(NUM_ORG, { name: "C1", assetTag: first.suggestion }, "t");
    const second = await suggestAssetNumber(NUM_ORG, {
      site: "Plant 1",
      line: "Line A",
      assetType: "conveyor",
    });
    expect(second.suggestion).toBe("PLANT-LINEA-CONV-002");
  });

  it("always produces a number even with no location info", async () => {
    const r = await suggestAssetNumber("org_hier_noloc", { assetType: "pump" });
    expect(r.suggestion).toMatch(/^SITE-GEN-PUMP-\d{3}$/);
  });
});

describe("Assignment resolution (match existing vs. propose new)", () => {
  it("returns a high-confidence match on exact serial number", async () => {
    const asset = await createAsset(
      OTHER,
      { name: "Pump 12", manufacturer: "Grundfos", model: "CR15", serialNumber: "SN-PUMP-777", assetType: "pump" },
      "t"
    );
    const r = await resolveAssetForGeneration(OTHER, {
      manufacturer: "Grundfos",
      model: "CR15",
      serialNumber: "SN-PUMP-777",
    });
    expect(r.bestMatch).not.toBeNull();
    expect(r.bestMatch!.asset.id).toBe(asset.id);
    expect(r.bestMatch!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("proposes a new asset (no false match) for an unknown machine", async () => {
    const r = await resolveAssetForGeneration(OTHER, {
      manufacturer: "Siemens",
      model: "SuperNovel-9000",
      serialNumber: "SN-UNKNOWN-1",
    });
    expect(r.bestMatch).toBeNull();
    expect(r.newAssetDraft.name).toContain("Siemens");
    expect(r.suggestedNumber).toMatch(/-\d{3}$/);
  });

  it("scopes resolution to the org (tenant isolation)", async () => {
    // OTHER has Pump 12; a different org must NOT see it.
    const r = await resolveAssetForGeneration("org_hier_isolated", {
      serialNumber: "SN-PUMP-777",
    });
    expect(r.bestMatch).toBeNull();
  });
});
