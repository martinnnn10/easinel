import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { createAsset } from "@/lib/assets/repository";
import { createWorkOrder, transitionWorkOrder } from "@/lib/workorders/repository";
import { db, ensureDb } from "@/lib/db";
import { users, documents } from "@/lib/db/schema";
import { memoryDocId } from "@/lib/workorders/memory";
import { getReuseImpact } from "./impact";
import { findSurfacedEvent, logCitationReuse } from "./events";

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
  await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "u_reuse_author" });
  await transitionWorkOrder(ORG, wo.id, "done", { downtimeMins: 40, resolution: "cleaned filter", actor: "u_reuse_author" });
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

describe("Copilot citation reuse", () => {
  it("credits a cited lesson to the tech who documented it, and fences to the org's own knowledge", async () => {
    await ensureDb();
    // Name the closer so author resolution has a display name.
    await db.insert(users).values({ id: "u_reuse_author", orgId: ORG, email: "maria-reuse@plant.com", name: "Maria Diaz", role: "technician" });
    // A document owned by ANOTHER org — must never be credited to this org.
    await db.insert(documents).values({ id: "doc_foreign", orgId: "org_other", filename: "Foreign manual.pdf", kind: "manual" });

    // Copilot cited the lesson captured from the assisted repair (authored by
    // Maria at close-out) plus a foreign doc. Two answers cite the lesson.
    const lessonDoc = memoryDocId(assistedId);
    await logCitationReuse(ORG, [{ documentId: lessonDoc }, { documentId: "doc_foreign" }], { assetId: assetA, userId: "u_reader" });
    await logCitationReuse(ORG, [{ documentId: lessonDoc }], { assetId: assetA, userId: "u_reader2" });

    const r = await getReuseImpact(ORG, 90);
    expect(r.knowledgeCitations).toBe(2); // two citations of the lesson; foreign doc excluded
    const lesson = r.citedKnowledge.find((k) => k.kind === "lesson" && k.workOrderId === assistedId);
    expect(lesson).toBeTruthy();
    expect(lesson!.author).toBe("Maria Diaz");
    expect(lesson!.timesCited).toBe(2);
    // The foreign doc was never counted.
    expect(r.citedKnowledge.some((k) => k.sourceId === "doc_foreign")).toBe(false);
  });

  it("records an uploaded document citation without inventing an author", async () => {
    await ensureDb();
    await db.insert(documents).values({ id: "doc_own_manual", orgId: ORG, filename: "VFD manual.pdf", kind: "manual" });
    await logCitationReuse(ORG, [{ documentId: "doc_own_manual" }], { userId: "u_reader" });

    const r = await getReuseImpact(ORG, 90);
    const doc = r.citedKnowledge.find((k) => k.sourceId === "doc_own_manual");
    expect(doc).toBeTruthy();
    expect(doc!.kind).toBe("document");
    expect(doc!.author).toBeNull(); // uploaded docs carry no per-person author
    expect(doc!.workOrderId).toBeNull();
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
