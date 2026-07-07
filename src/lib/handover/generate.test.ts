import { describe, it, expect } from "vitest";
import { createWorkOrder, transitionWorkOrder } from "@/lib/workorders/repository";
import { createAsset } from "@/lib/assets/repository";
import { createProgram } from "@/lib/pm/repository";
import { generateHandover } from "./generate";

const ORG = "org_handover_test";

describe("shift handover digest", () => {
  it("aggregates open/closed work into a grounded digest, org-scoped", async () => {
    // Open urgent WO
    await createWorkOrder(ORG, { title: "Line 2 packer down", priority: "urgent", type: "corrective" }, "t");
    // A closed WO (this shift)
    const done = await createWorkOrder(ORG, { title: "Fixed sensor", type: "corrective" }, "t");
    await transitionWorkOrder(ORG, done.id, "done", { resolution: "replaced sensor" });
    // A down machine
    await createAsset(ORG, { name: "Packer PK-2", status: "down" }, "t");

    const d = await generateHandover(ORG, 12);
    expect(d.stats.open).toBeGreaterThanOrEqual(1);
    expect(d.closedThisShift.some((w) => w.title === "Fixed sensor")).toBe(true);
    expect(d.machinesDown.some((m) => m.name === "Packer PK-2")).toBe(true);
    // Watch items call out the urgent work and the down machine.
    const watch = d.watchItems.join(" ").toLowerCase();
    expect(watch).toMatch(/down|urgent|high/);
    expect(d.markdown).toContain("Shift Handover");
    expect(d.markdown).toContain("Watch items");
  });

  it("does not leak another org's board", async () => {
    await createWorkOrder("org_other_ho", { title: "OTHER ORG secret", priority: "urgent" }, "t");
    const d = await generateHandover(ORG, 12);
    expect(d.markdown.includes("OTHER ORG secret")).toBe(false);
  });

  it("requires orgId", async () => {
    await expect(generateHandover("", 12)).rejects.toThrow();
  });

  it("flags a machine with a recurring fault and whether a PM already covers it", async () => {
    const RORG = "org_handover_repeat";
    const a = await createAsset(RORG, { name: "Filler F1" }, "t");
    // Three closed corrective repairs for the SAME recurring fault on this machine.
    for (let i = 0; i < 3; i++) {
      const wo = await createWorkOrder(RORG, { title: `Bearing replace ${i}`, symptom: "drive-end bearing failure", assetId: a.id, type: "corrective" }, "t");
      await transitionWorkOrder(RORG, wo.id, "done", { resolution: "replaced bearing", downtimeMins: 60 });
    }
    // A different machine with a one-off — must NOT be flagged.
    const b = await createAsset(RORG, { name: "Capper C2" }, "t");
    const one = await createWorkOrder(RORG, { title: "seal weep", symptom: "seal weep at inlet", assetId: b.id, type: "corrective" }, "t");
    await transitionWorkOrder(RORG, one.id, "done", { resolution: "replaced seal", downtimeMins: 10 });

    const d = await generateHandover(RORG, 12);
    const risk = d.repeatRisks.find((r) => r.assetId === a.id);
    expect(risk).toBeTruthy();
    expect(risk!.count).toBe(3);
    expect(risk!.pmState).toBe("none"); // no PM yet → the payoff callout
    expect(risk!.sourceWorkOrderId).toBeTruthy(); // seeds a one-tap Suggest-PM draft
    expect(d.repeatRisks.some((r) => r.assetId === b.id)).toBe(false); // one-off not flagged
    expect(d.stats.repeatRisks).toBeGreaterThanOrEqual(1);
    expect(d.watchItems.join(" ")).toMatch(/recurring fault and no PM/i);
    expect(d.markdown).toContain("Repeat risks");

    // Once a PM is drafted for that machine, the risk reads "draft" (not "none")
    // so it can't be double-suggested; it drops out of the no-PM watch item.
    await createProgram(RORG, { assetId: a.id, title: "Bearing PM" }, "mgr@x.com");
    const d2 = await generateHandover(RORG, 12);
    expect(d2.repeatRisks.find((r) => r.assetId === a.id)!.pmState).toBe("draft");
    expect(d2.watchItems.join(" ")).not.toMatch(/recurring fault and no PM/i);
  });
});
