import { describe, it, expect } from "vitest";

import { createWorkOrder, updateWorkOrder, transitionWorkOrder } from "@/lib/workorders/repository";
import { createAsset } from "@/lib/assets/repository";
import { generateRca } from "./generate";
import { saveRca, rcaDocId } from "./save";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const ORG = "org_rca_test";

async function closedCorrective(mfr: string, opts: { rootCause?: string; failedPart?: string; symptom?: string; title: string }) {
  const asset = await createAsset(ORG, { name: "RCA Machine", manufacturer: mfr, model: "RX-1", assetType: "pump" }, "t");
  const wo = await createWorkOrder(ORG, { title: opts.title, symptom: opts.symptom, assetId: asset.id, type: "corrective" }, "t");
  await transitionWorkOrder(ORG, wo.id, "in_progress");
  if (opts.rootCause || opts.failedPart) {
    await updateWorkOrder(ORG, wo.id, { rootCause: opts.rootCause, failedPart: opts.failedPart, repairAction: "replaced the part" });
  }
  await transitionWorkOrder(ORG, wo.id, "done", { resolution: "fixed and verified" });
  return { assetId: asset.id, wo };
}

describe("RCA generation", () => {
  it("builds a grounded RCA from a closed corrective work order", async () => {
    const { wo } = await closedCorrective("RcaVendorA", {
      title: "Pump P-1 seal leak",
      symptom: "seal weeping, worsening with vibration",
      rootCause: "coupling misalignment accelerated seal wear",
      failedPart: "mechanical seal",
    });
    const rca = await generateRca(ORG, wo.id);
    expect(rca).not.toBeNull();
    expect(rca!.grounded).toBe(true);
    expect(rca!.rootCause).toContain("misalignment");
    const md = rca!.markdown;
    expect(md).toContain("Problem statement");
    expect(md).toContain("5-Why");
    expect(md).toContain("mechanical seal");
    expect(md).toContain("coupling misalignment");
    expect(md).toContain("Evidence");
    expect(rca!.aiGenerated).toBe(false); // no live provider in test
  });

  it("is honest when no root cause was recorded (not grounded, prompts capture)", async () => {
    const { wo } = await closedCorrective("RcaVendorB", { title: "Quick reset", symptom: "tripped" });
    const rca = await generateRca(ORG, wo.id);
    expect(rca!.grounded).toBe(false);
    expect(rca!.markdown).toMatch(/not recorded/i);
  });

  it("flags a repeat failure as a contributing factor", async () => {
    // Two failures on the SAME asset with the same failed part.
    const asset = await createAsset(ORG, { name: "Repeat Pump", manufacturer: "RcaVendorC", model: "RX-2", assetType: "pump" }, "t");
    for (const n of [1, 2]) {
      const wo = await createWorkOrder(ORG, { title: `bearing failure #${n}`, assetId: asset.id, type: "corrective" }, "t");
      await updateWorkOrder(ORG, wo.id, { rootCause: "bearing seizure", failedPart: "drive-end bearing" });
      await transitionWorkOrder(ORG, wo.id, "done", { resolution: "replaced bearing" });
    }
    const wos = await (await import("@/lib/workorders/repository")).listWorkOrders(ORG, { assetId: asset.id });
    const latest = wos[0];
    const rca = await generateRca(ORG, latest.id);
    expect(rca!.repeatCount).toBeGreaterThanOrEqual(1);
    expect(rca!.markdown).toMatch(/repeat failure/i);
  });

  it("saves the RCA as a retrievable kind='rca' document, idempotently", async () => {
    const { wo } = await closedCorrective("RcaVendorD", { title: "Motor overheats", rootCause: "blocked cooling", failedPart: "cooling fan" });
    const rca = await generateRca(ORG, wo.id);
    await saveRca(ORG, rca!, "t");
    await saveRca(ORG, rca!, "t"); // idempotent
    const docs = await db.select().from(documents).where(and(eq(documents.orgId, ORG), eq(documents.id, rcaDocId(wo.id))));
    expect(docs.length).toBe(1);
    expect(docs[0].kind).toBe("rca");
  });

  it("is org-scoped: another org cannot generate an RCA for this WO", async () => {
    const { wo } = await closedCorrective("RcaVendorE", { title: "scoped", rootCause: "x", failedPart: "y" });
    expect(await generateRca("org_other", wo.id)).toBeNull();
  });

  it("requires orgId", async () => {
    await expect(generateRca("", "x")).rejects.toThrow();
  });
});
