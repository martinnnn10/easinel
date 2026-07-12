import { describe, it, expect } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { createWorkOrder, updateWorkOrder, getWorkOrder } from "./repository";
import { classifyAssetClass, classifyFailureType } from "@/lib/today/classify";

const ORG = "org_wo_planner";

describe("Fix 3 — planner MVP fields persist on a work order", () => {
  it("round-trips assignedTo and scheduledFor", async () => {
    await ensureDb();
    const wo = await createWorkOrder(ORG, { title: "Wrapper VFD F070 trip", type: "corrective" }, "u1");
    expect(wo.assignedTo ?? null).toBeNull();
    expect(wo.scheduledFor ?? null).toBeNull();

    const when = new Date("2026-07-20T00:00:00.000Z").getTime();
    const updated = await updateWorkOrder(
      ORG,
      wo.id,
      { assignedTo: "Maria (2nd shift)", scheduledFor: when },
      "u1"
    );
    expect(updated!.assignedTo).toBe("Maria (2nd shift)");
    expect(updated!.scheduledFor instanceof Date ? updated!.scheduledFor.getTime() : Number(updated!.scheduledFor)).toBe(when);

    // Clearing the schedule sets it back to null.
    const cleared = await updateWorkOrder(ORG, wo.id, { scheduledFor: null }, "u1");
    expect(cleared!.scheduledFor ?? null).toBeNull();

    // Persisted (fresh read, not just the returned row).
    const reread = await getWorkOrder(ORG, wo.id);
    expect(reread!.assignedTo).toBe("Maria (2nd shift)");
  });
});

describe("Fix 2 — Work Orders board reuses the Today classification helpers", () => {
  it("derives the same asset class + failure type used on Today (single taxonomy)", async () => {
    await ensureDb();
    await db.insert(assets).values({
      id: "ast_wo_ctx",
      orgId: ORG,
      name: "Line 3 Case Packer",
      assetType: "packaging",
      criticality: "critical",
    });
    const wo = await createWorkOrder(
      ORG,
      { title: "Photoeye missing case", assetId: "ast_wo_ctx", type: "corrective", symptom: "photoeye not detecting" },
      "u1"
    );

    // The exact helpers the enriched GET /api/work-orders route calls.
    const cls = classifyAssetClass({ name: "Line 3 Case Packer", model: null, assetType: "packaging" });
    const ft = classifyFailureType([wo.title, wo.symptom].filter(Boolean).join(" "));
    expect(cls).toBe("Case Packer");
    expect(ft).toBe("Instrumentation / Sensor");
  });
});
