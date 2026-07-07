import { describe, it, expect } from "vitest";
import { deriveRepeatRisks, faultKeyOf } from "./repeatRisks";
import type { WorkOrder } from "@/lib/db/schema";

// Minimal WorkOrder shape for the pure derivation (only the fields it reads).
function wo(p: Partial<WorkOrder>): WorkOrder {
  return {
    type: "corrective", status: "done", assetId: "a1",
    title: null, symptom: null, rootCause: null, failedPart: null,
    downtimeMins: null, closedAt: new Date(1_000), updatedAt: new Date(1_000),
    ...p,
  } as WorkOrder;
}
const NAMES = new Map([["a1", "Filler F1"], ["a2", "Capper C2"]]);

describe("faultKeyOf", () => {
  it("keys on a letter-prefixed fault code, not a bare measurement number", () => {
    expect(faultKeyOf(wo({ symptom: "F074 undervoltage trip" }))).toBe("F074");
    expect(faultKeyOf(wo({ symptom: "ran at 480 volts on the line" }))).not.toBe("480");
  });
  it("falls back to failed part, then a significant keyword (noise filtered)", () => {
    expect(faultKeyOf(wo({ failedPart: "drive-end bearing" }))).toBe("drive-end bearing");
    expect(faultKeyOf(wo({ symptom: "conveyor jam on the exit" }))).toBe("conveyor");
    // shift/unit noise words are filtered and never anchor a group
    const k = faultKeyOf(wo({ symptom: "cleared jam on the line in 20 minutes" }));
    expect(k).not.toBe("line");
    expect(k).not.toBe("minutes");
  });
});

describe("deriveRepeatRisks", () => {
  const NOW = 10_000_000_000;
  const recent = (n: number) => new Date(NOW - n * 86400_000);

  it("flags a machine at/above the threshold, with PM coverage state", () => {
    const wos = [
      wo({ id: "w1", failedPart: "bearing", closedAt: recent(1), downtimeMins: 60 }),
      wo({ id: "w2", failedPart: "bearing", closedAt: recent(2), downtimeMins: 40 }),
      wo({ id: "w3", failedPart: "bearing", closedAt: recent(3), downtimeMins: 50 }),
    ];
    const risks = deriveRepeatRisks(wos, NAMES, [], { now: NOW });
    expect(risks).toHaveLength(1);
    expect(risks[0].assetName).toBe("Filler F1");
    expect(risks[0].count).toBe(3);
    expect(risks[0].totalDowntimeMins).toBe(150);
    expect(risks[0].pmState).toBe("none");
    expect(risks[0].sourceWorkOrderId).toBe("w1"); // newest seeds the PM draft
  });

  it("reads pmState from real programs and excludes non-corrective / open / out-of-window", () => {
    const wos = [
      wo({ id: "w1", failedPart: "seal", closedAt: recent(1) }),
      wo({ id: "w2", failedPart: "seal", closedAt: recent(2) }),
      wo({ id: "w3", failedPart: "seal", closedAt: recent(3) }),
      wo({ id: "w4", failedPart: "seal", status: "open", closedAt: recent(1) }), // open — ignored
      wo({ id: "w5", failedPart: "seal", type: "pm", closedAt: recent(1) }), // not corrective — ignored
      wo({ id: "w6", failedPart: "seal", closedAt: recent(400) }), // out of window — ignored
    ];
    const active = deriveRepeatRisks(wos, NAMES, [{ assetId: "a1", status: "active" }], { now: NOW });
    expect(active[0].count).toBe(3);
    expect(active[0].pmState).toBe("active");
    const draft = deriveRepeatRisks(wos, NAMES, [{ assetId: "a1", status: "draft" }], { now: NOW });
    expect(draft[0].pmState).toBe("draft");
  });

  it("does NOT fabricate a group from a coincidental number or noise word", () => {
    const wos = [
      wo({ id: "w1", symptom: "480V supply blip on the feed line", closedAt: recent(1) }),
      wo({ id: "w2", symptom: "photo-eye read 480 lux on the exit line", closedAt: recent(2) }),
      wo({ id: "w3", symptom: "coolant weep near the 480 pipe on the line", closedAt: recent(3) }),
    ];
    const risks = deriveRepeatRisks(wos, NAMES, [], { now: NOW });
    expect(risks.some((r) => r.label === "480" || r.label === "line")).toBe(false);
    expect(risks.every((r) => r.count < 3)).toBe(true);
  });
});
