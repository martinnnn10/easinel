import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL so the helper exercises the real SQL path. Set BEFORE
// importing the db module.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createWorkOrder,
  transitionWorkOrder,
  getWorkOrder,
} from "./repository";
import { findPriorFixes } from "./recurrence";
import { createAsset } from "@/lib/assets/repository";

const ORG = "org_recur";

// Helper: create a corrective WO and close it out with captured fields.
async function closedRepair(
  assetId: string,
  symptom: string,
  fields: { rootCause?: string; failedPart?: string; repairAction?: string; downtimeMins?: number } = {}
) {
  const wo = await createWorkOrder(ORG, { title: symptom, symptom, assetId, type: "corrective" });
  await transitionWorkOrder(ORG, wo.id, "in_progress");
  await transitionWorkOrder(ORG, wo.id, "done", {
    resolution: fields.repairAction ?? "fixed",
    downtimeMins: fields.downtimeMins ?? null,
    actor: "t",
  });
  // updateWorkOrder-style capture of the analysis fields (mirrors the close-out).
  const { updateWorkOrder } = await import("./repository");
  await updateWorkOrder(ORG, wo.id, {
    rootCause: fields.rootCause ?? null,
    failedPart: fields.failedPart ?? null,
    repairAction: fields.repairAction ?? null,
  });
  return wo.id;
}

let assetA: string;
let assetB: string;

beforeAll(async () => {
  const a = await createAsset(ORG, { name: "Conveyor 3", assetTag: "CONV3" });
  const b = await createAsset(ORG, { name: "Pump 12", assetTag: "P12" });
  assetA = a.id;
  assetB = b.id;
  // Two prior F007 repairs on assetA.
  await closedRepair(assetA, "Conveyor 3 F007 overload ~20 min into run", {
    failedPart: "panel fan", repairAction: "Replaced panel fan, cleaned filter", downtimeMins: 42,
  });
  await closedRepair(assetA, "F007 overload again after warm-up", {
    rootCause: "panel overheating", repairAction: "Cleaned intake filter", downtimeMins: 30,
  });
  // An unrelated repair with an incidental 2-digit number in the title.
  await closedRepair(assetA, "Line 12 guard interlock nuisance trip", {
    repairAction: "Adjusted interlock switch", downtimeMins: 15,
  });
});

describe("findPriorFixes — machine-memory recurrence", () => {
  it("surfaces prior fixes for a matching fault code, scoped to the asset", async () => {
    const r = await findPriorFixes(ORG, { assetId: assetA, symptom: "Conveyor 3 tripping on F007 overload again" });
    expect(r).not.toBeNull();
    expect(r!.label).toBe("F007");
    expect(r!.count).toBe(2); // only the two F007 repairs, not the Line 12 one
    expect(r!.totalDowntimeMins).toBe(72);
    // Most recent matching repair's proven fix — never the WO title.
    expect(r!.last?.fix).toBeTruthy();
    expect(r!.last?.fix).not.toContain("F007 overload"); // not the problem statement
  });

  it("does NOT treat an incidental 2-digit number as a fault code (honesty)", async () => {
    // No asset + no real fault code → too little signal → null (no false match).
    const r = await findPriorFixes(ORG, { symptom: "Line 12 guard interlock nuisance trip" });
    expect(r).toBeNull();
  });

  it("returns null when nothing matches (honest empty state)", async () => {
    const r = await findPriorFixes(ORG, { assetId: assetB, symptom: "Totally unrelated hydraulic leak" });
    expect(r).toBeNull();
  });

  it("is tenant-scoped — never returns another org's repairs", async () => {
    const r = await findPriorFixes("org_other", { assetId: assetA, symptom: "F007 overload" });
    expect(r).toBeNull();
  });
});

describe("close-out downtime is authoritative and re-close-safe", () => {
  it("prefers the explicit downtime over the wall-clock estimate", async () => {
    const wo = await createWorkOrder(ORG, { title: "dt", symptom: "x", assetId: assetA, type: "corrective" });
    await transitionWorkOrder(ORG, wo.id, "in_progress");
    await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins: 55, actor: "t" });
    const row = await getWorkOrder(ORG, wo.id);
    expect(row?.downtimeMins).toBe(55);
  });

  it("an idempotent re-close does not recompute or wipe the captured downtime", async () => {
    const wo = await createWorkOrder(ORG, { title: "dt2", symptom: "x", assetId: assetA, type: "corrective" });
    await transitionWorkOrder(ORG, wo.id, "in_progress");
    await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins: 88, actor: "t" });
    // Second "→ done" (idempotent) with NO explicit downtime must not touch it.
    const res = await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins: null, actor: "t" });
    expect(res.workOrder?.downtimeMins).toBe(88);
    const row = await getWorkOrder(ORG, wo.id);
    expect(row?.downtimeMins).toBe(88);
  });
});
