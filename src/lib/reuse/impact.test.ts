import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { createAsset } from "@/lib/assets/repository";
import { createWorkOrder, transitionWorkOrder } from "@/lib/workorders/repository";
import { getReuseImpact } from "./impact";
import { findSurfacedEvent } from "./events";

const ORG = "org_reuse";

// Close a corrective F007 repair on an asset with a captured downtime.
async function repair(assetId: string, downtimeMins: number, actor: string) {
  const wo = await createWorkOrder(ORG, {
    title: "F007 overload trip", symptom: "F007 overload trip after warmup",
    assetId, type: "corrective",
  });
  await transitionWorkOrder(ORG, wo.id, "in_progress", { actor });
  await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins, resolution: "cleaned intake filter", actor });
  return wo.id;
}

let assetA: string;
let assistedId: string;

beforeAll(async () => {
  const a = await createAsset(ORG, { name: "Case Packer L3" });
  assetA = a.id;
  // Two prior F007 repairs establish the history/baseline.
  await repair(assetA, 120, "u_jose");
  await repair(assetA, 100, "u_jose");
  // A third F007 — prior knowledge is surfaced at intake, and it closes faster.
  const wo = await createWorkOrder(ORG, {
    title: "F007 overload trip", symptom: "F007 overload trip again",
    assetId: assetA, type: "corrective",
  });
  assistedId = wo.id;
  await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "u_maria" });
  await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins: 40, resolution: "cleaned filter", actor: "u_maria" });
});

describe("knowledge reuse loop", () => {
  it("logs prior_fix_surfaced when a repeat fault is created on the same asset", async () => {
    const surfaced = await findSurfacedEvent(ORG, assistedId);
    expect(surfaced).not.toBeNull();
    expect(surfaced!.label).toBe("F007");
    expect(surfaced!.sourceType).toBe("prior_work_order");
  });

  it("counts repeats caught at intake and work orders assisted", async () => {
    const r = await getReuseImpact(ORG, 90);
    expect(r.hasData).toBe(true);
    // The 2nd and 3rd F007 both had a prior fix at intake.
    expect(r.repeatsCaughtAtIntake).toBeGreaterThanOrEqual(2);
    expect(r.workOrdersAssisted).toBeGreaterThanOrEqual(2);
    expect(r.mostReusedFixes.length).toBeGreaterThanOrEqual(1);
    expect(r.mostReusedFixes[0].label).toBe("F007");
    // Impact-first ranking: the fix with proven avoided downtime leads, and the
    // saved time is attributed to it (the "Jose line").
    expect(r.mostReusedFixes[0].avoidedDowntimeHours).toBeCloseTo(1.2, 1);
    expect(r.mostReusedFixes[0].timesUsed).toBeGreaterThanOrEqual(1);
  });

  it("credits avoided downtime only for repairs with enough prior history", async () => {
    const r = await getReuseImpact(ORG, 90);
    // Only the 3rd repair has >=2 priors to compare against; the 2nd has just 1.
    expect(r.comparableWorkOrders).toBe(1);
    expect(r.hasEnoughForSavings).toBe(true);
    // median(120,100)=110; the assisted repair took 40 → 70 min = ~1.2h avoided.
    expect(r.avoidedDowntimeHours).toBeCloseTo(1.2, 1);
    // No rate set → dollars stay null (never invented).
    expect(r.avoidedDowntimeCost).toBeNull();
  });
});

describe("honest empty + not-enough-history", () => {
  it("a fresh org has no reuse data", async () => {
    const r = await getReuseImpact("org_fresh_reuse", 90);
    expect(r.hasData).toBe(false);
    expect(r.avoidedDowntimeHours).toBeNull();
    expect(r.hasEnoughForSavings).toBe(false);
  });

  it("does not invent savings when there is only one prior failure", async () => {
    const b = await createAsset(ORG, { name: "Pump 9" });
    await repair(b.id, 60, "u_jose"); // one prior only
    const wo = await createWorkOrder(ORG, { title: "F007", symptom: "F007 overload", assetId: b.id, type: "corrective" });
    await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "u_maria" });
    await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins: 10, resolution: "x", actor: "u_maria" });
    // The Pump 9 assisted WO has only 1 prior → excluded from comparison; it must
    // not fabricate avoided downtime for that machine.
    const r = await getReuseImpact(ORG, 90);
    // comparableWorkOrders stays 1 (still only the Case Packer's 3rd repair qualifies).
    expect(r.comparableWorkOrders).toBe(1);
  });
});
