import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { createAsset } from "@/lib/assets/repository";
import { createWorkOrder, transitionWorkOrder, updateWorkOrder } from "@/lib/workorders/repository";
import { setDowntimeRate } from "@/lib/auth/session";
import { getActivationProgress } from "./progress";

const ORG = "org_activation";

beforeAll(async () => {
  await ensureDb();
  // Real orgs always have an orgs row (created at signup); the rate lives there.
  await db.insert(orgs).values({ id: ORG, name: "Activation Co" });
});

describe("getActivationProgress", () => {
  it("starts fully empty for a brand-new org", async () => {
    const p = await getActivationProgress("org_fresh_empty");
    expect(p.completed).toBe(0);
    expect(p.done).toBe(false);
    expect(p.hasAsset).toBe(false);
  });

  it("flips each milestone as the real record is created", async () => {
    const a = await createAsset(ORG, { name: "Pump 7" });
    let p = await getActivationProgress(ORG);
    expect(p.hasAsset).toBe(true);
    expect(p.hasClosedWithMemory).toBe(false);

    // Open + close a corrective WO WITHOUT captured knowledge → not yet memory.
    const bare = await createWorkOrder(ORG, { title: "x", symptom: "x", assetId: a.id, type: "corrective" });
    await transitionWorkOrder(ORG, bare.id, "in_progress");
    await transitionWorkOrder(ORG, bare.id, "done", { actor: "t" });
    p = await getActivationProgress(ORG);
    expect(p.hasWorkOrder).toBe(true);
    expect(p.hasClosedWithMemory).toBe(false);

    // Close one WITH a root cause → machine memory milestone met.
    const real = await createWorkOrder(ORG, { title: "F007", symptom: "F007 overload", assetId: a.id, type: "corrective" });
    await transitionWorkOrder(ORG, real.id, "in_progress");
    await transitionWorkOrder(ORG, real.id, "done", { resolution: "cleaned filter", actor: "t" });
    await updateWorkOrder(ORG, real.id, { rootCause: "overheating" });
    p = await getActivationProgress(ORG);
    expect(p.hasClosedWithMemory).toBe(true);

    // Setting a downtime rate flips the last non-doc/chat milestone.
    await setDowntimeRate(ORG, 2500);
    p = await getActivationProgress(ORG);
    expect(p.hasDowntimeRate).toBe(true);
  });
});
