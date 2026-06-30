import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL + no live AI provider, so the generator uses the grounded
// structured ladder deterministically (no key set → refineDetailWithDocs falls back).
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

import { generatePmProgram, PM_CADENCES } from "./generate";
import { listPrograms, getProgram } from "./repository";
import { createAsset } from "@/lib/assets/repository";
import { createWorkOrder, updateWorkOrder } from "@/lib/workorders/repository";

const ORG = "org_pmgen_test";
const OTHER = "org_pmgen_other";

describe("AI PM-program generator", () => {
  beforeAll(async () => {
    await listPrograms(ORG); // ensure schema created
  });

  it("generates all five cadences as drafts from a free-text model/serial", async () => {
    const res = await generatePmProgram(
      ORG,
      { manufacturer: "SEW-Eurodrive", model: "R97 gear reducer", serialNumber: "SN-GBX-0001" },
      "tester"
    );

    // Five cadences: 30/60/90-day, semi-annual, annual.
    expect(res.cadences).toHaveLength(5);
    expect(res.cadences.map((c) => c.cadenceKey).sort()).toEqual(
      PM_CADENCES.map((c) => c.key).sort()
    );
    expect(res.cadences.map((c) => c.intervalDays).sort((a, b) => a - b)).toEqual([30, 60, 90, 180, 365]);

    // Each cadence has real, structured tasks.
    for (const c of res.cadences) {
      expect(c.taskCount).toBeGreaterThanOrEqual(3);
      expect(c.programId).toBeTruthy();
    }

    // All five were persisted as DRAFTS (nothing auto-activated).
    const programs = await listPrograms(ORG);
    const generated = programs.filter((p) =>
      res.cadences.some((c) => c.programId === p.id)
    );
    expect(generated).toHaveLength(5);
    for (const p of generated) {
      expect(p.status).toBe("draft");
      expect(p.source).toBe("ai_suggested");
    }
  });

  it("links the program to an existing asset matched by model", async () => {
    const asset = await createAsset(
      ORG,
      { name: "Press Hydraulic Pump", assetType: "pump", manufacturer: "Parker", model: "PV270-XYZ" },
      "tester"
    );
    const res = await generatePmProgram(ORG, { model: "PV270-XYZ" }, "tester");
    expect(res.matchedAssetId).toBe(asset.id);
    expect(res.cadences).toHaveLength(5);
  });

  it("grounds the PM in REAL plant history (corrective WO root cause → emphasis + evidence) and emits structured tasks", async () => {
    const asset = await createAsset(
      ORG,
      { name: "Line 3 Booster Pump", assetType: "pump", manufacturer: "Goulds", model: "3196-XYZ" },
      "tester"
    );
    // A real corrective repair on this asset.
    const wo = await createWorkOrder(
      ORG,
      { title: "Pump seal leak", symptom: "Seal weeping at shaft", assetId: asset.id, type: "corrective" },
      "tester"
    );
    await updateWorkOrder(
      ORG,
      wo.id,
      { rootCause: "Misalignment driving repeat seal failure", failedPart: "Mechanical seal", repairAction: "Re-aligned coupling and replaced seal" },
      "tester"
    );

    const res = await generatePmProgram(ORG, { assetId: asset.id }, "tester");
    expect(res.matchedAssetId).toBe(asset.id);
    expect(res.plantHistoryCount).toBeGreaterThanOrEqual(1);

    // The program reasoning + evidence reflect the REAL repair, and the
    // failureMode emphasis is drawn from the recorded root cause/failed part.
    const detail = await getProgram(ORG, res.cadences[0].programId);
    expect(detail).toBeTruthy();
    expect(detail!.reasoning ?? "").toMatch(/Misalignment|seal/i);
    expect(detail!.evidence.some((e) => /seal|Misalignment/i.test(e.detail ?? ""))).toBe(true);
    expect(detail!.failureMode ?? "").toBeTruthy();

    // Tasks are STRUCTURED: at least one carries a parsed detail object with an
    // operatingState, and exactly one is the LOTO transition.
    const withDetail = detail!.tasks.filter((t) => t.detail && typeof t.detail === "object");
    expect(withDetail.length).toBeGreaterThan(0);
    const states = withDetail.map((t) => (t.detail as { operatingState?: string }).operatingState);
    const lotoCount = withDetail.filter((t) => (t.detail as { isLotoTransition?: boolean }).isLotoTransition).length;
    expect(lotoCount).toBe(1);
    // First structured step is a running observation, not LOTO.
    expect(String(states[0] ?? "")).toMatch(/Running/);
  });

  it("requires at least one identity field", async () => {
    await expect(generatePmProgram(ORG, {}, "tester")).rejects.toThrow();
  });

  it("is tenant-scoped (generated programs do not leak across orgs)", async () => {
    const res = await generatePmProgram(OTHER, { model: "Isolated Machine X1" }, "tester");
    const inOrg = await listPrograms(ORG);
    expect(inOrg.find((p) => res.cadences.some((c) => c.programId === p.id))).toBeUndefined();
  });
});
