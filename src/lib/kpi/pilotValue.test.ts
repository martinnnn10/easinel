import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { createWorkOrder, transitionWorkOrder, updateWorkOrder } from "@/lib/workorders/repository";
import { createAsset } from "@/lib/assets/repository";
import { calculatePilotValue } from "./pilotValue";

const ORG = "org_pv";

async function closedCorrective(
  assetId: string,
  symptom: string,
  fields: { rootCause?: string; repairAction?: string; downtimeMins?: number } = {}
) {
  const wo = await createWorkOrder(ORG, { title: symptom, symptom, assetId, type: "corrective" });
  await transitionWorkOrder(ORG, wo.id, "in_progress");
  await transitionWorkOrder(ORG, wo.id, "done", {
    resolution: fields.repairAction ?? "fixed",
    downtimeMins: fields.downtimeMins ?? null,
    actor: "t",
  });
  await updateWorkOrder(ORG, wo.id, {
    rootCause: fields.rootCause ?? null,
    repairAction: fields.repairAction ?? null,
  });
  return wo.id;
}

let assetA: string;

beforeAll(async () => {
  const a = await createAsset(ORG, { name: "Conveyor 3", assetTag: "CONV3" });
  assetA = a.id;
  // Two F007 failures on the same asset → one recurring pattern.
  await closedCorrective(assetA, "F007 overload trip", { rootCause: "panel overheating", repairAction: "cleaned filter", downtimeMins: 60 });
  await closedCorrective(assetA, "F007 overload again after warm-up", { repairAction: "replaced fan", downtimeMins: 30 });
  // An unrelated failure with an incidental 2-digit number — must NOT group.
  await closedCorrective(assetA, "Line 12 guard nuisance trip", { repairAction: "adjusted switch", downtimeMins: 10 });
});

describe("calculatePilotValue", () => {
  it("captures machine memory from corrective closes with real fields", async () => {
    const v = await calculatePilotValue(ORG, 90);
    // All three closes carried a repairAction/rootCause → counted as captured fixes.
    expect(v.capturedFixesAllTime).toBe(3);
    expect(v.hasMemory).toBe(true);
  });

  it("surfaces a recurring failure only for the real repeated fault code", async () => {
    const v = await calculatePilotValue(ORG, 90);
    expect(v.hasRecurring).toBe(true);
    expect(v.recurringCount).toBe(1); // F007 only — not the "Line 12" one
    const top = v.topRepeatFailures[0];
    expect(top.label).toBe("F007");
    expect(top.count).toBe(2);
    expect(top.downtimeHours).toBe(1.5); // 60 + 30 min
    expect(top.assetName).toBe("Conveyor 3");
  });

  it("keeps cost null until a downtime rate is set (no invented dollars)", async () => {
    const v = await calculatePilotValue(ORG, 90);
    expect(v.recurringDowntimeCost).toBeNull();
    expect(v.kpis.downtimeCost).toBeNull();
  });

  it("is tenant-scoped — a fresh org sees an honest empty summary", async () => {
    const v = await calculatePilotValue("org_empty", 90);
    expect(v.capturedFixesAllTime).toBe(0);
    expect(v.recurringCount).toBe(0);
    expect(v.hasMemory).toBe(false);
    expect(v.hasRecurring).toBe(false);
  });
});
