import { describe, it, expect, beforeAll } from "vitest";
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

import { analyzePmUpload } from "./analyzeUpload";
import { createAsset, listAssets } from "@/lib/assets/repository";

const ORG = "org_pmupload_test";

describe("PM upload intelligence (detect + confirm-before-save)", () => {
  beforeAll(async () => {
    await listAssets(ORG, {}); // ensure schema
  });

  it("detects machine identity from a readable PM document and proposes a new asset", async () => {
    const doc = [
      "PREVENTIVE MAINTENANCE PROCEDURE",
      "Manufacturer: SEW-Eurodrive",
      "Model No: R97 Gear Reducer",
      "Serial Number: SN-GBX-2048",
      "This gearbox requires monthly inspection and an annual oil change.",
    ].join("\n");
    const res = await analyzePmUpload(ORG, Buffer.from(doc, "utf8"), "pm_gearbox.txt", "text/plain");

    expect(res.readable).toBe(true);
    expect(res.identity.manufacturer?.toLowerCase()).toContain("sew");
    expect(res.identity.model?.toLowerCase()).toContain("r97");
    expect(res.identity.serialNumber).toBe("SN-GBX-2048");
    expect(res.identity.assetType).toBe("gearbox");
    expect(res.identity.cadenceHints).toEqual(expect.arrayContaining(["monthly", "annual"]));
    // Nothing saved yet — just a proposal with an editable number.
    expect(res.resolution).not.toBeNull();
    expect(res.resolution!.bestMatch).toBeNull();
    expect(res.resolution!.suggestedNumber).toMatch(/-\d{3}$/);
  });

  it("matches an existing asset by serial number for confirmation", async () => {
    await createAsset(
      ORG,
      { name: "Mixer Gearbox", manufacturer: "Nord", model: "SK 9032", serialNumber: "SN-MIX-9032", assetType: "gearbox" },
      "t"
    );
    const doc = "Maintenance manual. Manufacturer: Nord. Model: SK 9032. Serial No: SN-MIX-9032.";
    const res = await analyzePmUpload(ORG, Buffer.from(doc, "utf8"), "nord_manual.txt", "text/plain");
    expect(res.resolution!.bestMatch).not.toBeNull();
    expect(res.resolution!.bestMatch!.asset.name).toBe("Mixer Gearbox");
  });

  it("returns an honest non-readable result for binary with no text (no fabrication)", async () => {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x00, 0x10, 0x80]);
    const res = await analyzePmUpload(ORG, bin, "drawing.acd", "application/octet-stream");
    expect(res.readable).toBe(false);
    expect(res.identity.method).toBe("none");
    expect(res.resolution).toBeNull();
    expect(res.summary.toLowerCase()).toContain("manual");
  });
});
