import { describe, it, expect } from "vitest";
import { createWorkOrder, transitionWorkOrder } from "@/lib/workorders/repository";
import { createAsset } from "@/lib/assets/repository";
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
});
