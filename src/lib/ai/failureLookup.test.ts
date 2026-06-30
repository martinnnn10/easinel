import { describe, it, expect } from "vitest";
// In-memory libSQL so the repositories exercise the real SQL path. MUST be set
// before importing the db module.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { buildFailureLookupContext } from "./failureLookup";
import { createAsset } from "@/lib/assets/repository";
import { createWorkOrder, updateWorkOrder } from "@/lib/workorders/repository";

let n = 0;
const freshOrg = () => `org_fl_${Date.now()}_${n++}`;

describe("Copilot failure lookup", () => {
  it("resolves a failure by ASSET NUMBER / tag and surfaces root cause + failed part", async () => {
    const org = freshOrg();
    const asset = await createAsset(org, {
      name: "Gearbox GB-22",
      assetTag: "GB-22",
      site: "Plant 1",
      area: "Press Area",
      line: "Line A",
    });
    const wo = await createWorkOrder(org, {
      title: "Gearbox overheating and noise",
      assetId: asset.id,
      symptom: "High bearing temp and grinding noise after 2 hours",
      type: "corrective",
    });
    await updateWorkOrder(org, wo.id, {
      rootCause: "Drive-end bearing spalled due to lube starvation",
      failedPart: "Bearing 6312-2RS",
      repairAction: "Replaced bearing, re-greased, corrected lube interval",
    });

    const res = await buildFailureLookupContext(org, "what failed on GB-22?");
    expect(res.matched).toBe(true);
    expect(res.matchedAssetIds).toContain(asset.id);
    expect(res.context).toMatch(/Gearbox GB-22/);
    expect(res.context).toMatch(/lube starvation/i);
    expect(res.context).toMatch(/6312-2RS/);
    expect(res.context).toMatch(/Repair action/i);
  });

  it("resolves failures by AFFECTED AREA across multiple assets", async () => {
    const org = freshOrg();
    const a1 = await createAsset(org, { name: "Press 1", assetTag: "PR-1", area: "Stamping" });
    const a2 = await createAsset(org, { name: "Press 2", assetTag: "PR-2", area: "Stamping" });
    await createAsset(org, { name: "Mixer 9", assetTag: "MX-9", area: "Blending" });
    const w1 = await createWorkOrder(org, { title: "Hydraulic leak", assetId: a1.id, type: "corrective" });
    await updateWorkOrder(org, w1.id, { rootCause: "Cracked hose fitting" });
    const w2 = await createWorkOrder(org, { title: "Ram won't retract", assetId: a2.id, type: "corrective" });
    await updateWorkOrder(org, w2.id, { rootCause: "Failed directional valve" });

    const res = await buildFailureLookupContext(org, "what's been failing in the Stamping area?");
    expect(res.matched).toBe(true);
    // Only the two Stamping assets, not the Blending mixer.
    expect(res.matchedAssetIds).toContain(a1.id);
    expect(res.matchedAssetIds).toContain(a2.id);
    expect(res.context).toMatch(/Stamping/i);
    expect(res.context).toMatch(/Press 1/);
    expect(res.context).toMatch(/Press 2/);
    expect(res.context).not.toMatch(/Mixer 9/);
  });

  it("returns empty (no false match) when nothing in the question resolves", async () => {
    const org = freshOrg();
    await createAsset(org, { name: "Press 1", assetTag: "PR-1", area: "Stamping" });
    const res = await buildFailureLookupContext(org, "what is preventive maintenance philosophy?");
    expect(res.matched).toBe(false);
    expect(res.context).toBe("");
  });

  it("is tenant-scoped — never resolves another org's asset", async () => {
    const A = freshOrg();
    const B = freshOrg();
    await createAsset(A, { name: "Gearbox GB-22", assetTag: "GB-22", area: "Press Area" });
    const res = await buildFailureLookupContext(B, "what failed on GB-22?");
    expect(res.matched).toBe(false);
    expect(res.matchedAssetIds).toEqual([]);
  });
});
