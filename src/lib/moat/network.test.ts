import { describe, it, expect, beforeAll } from "vitest";
import { db, ensureDb } from "@/lib/db";
import { oemFailureSignals } from "@/lib/db/schema";
import { networkIntelligence, summarizeNetwork } from "./network";
import { id } from "@/lib/util";

beforeAll(async () => { await ensureDb(); });

async function seedSignal(s: {
  mfr: string; model: string; fault?: string | null; cat: string;
  downtime?: number; consent: boolean; org: string;
}) {
  await db.insert(oemFailureSignals).values({
    id: id("oem"),
    manufacturer: s.mfr,
    model: s.model,
    assetType: "vfd",
    faultCode: s.fault ?? null,
    resolutionCategory: s.cat,
    downtimeMins: s.downtime ?? null,
    laborMins: null,
    sharedConsent: s.consent,
    originOrgId: s.org,
  });
}

describe("cross-customer OEM network intelligence", () => {
  it("returns insufficient below the k-anonymity threshold", async () => {
    const MFR = "NetVendorA";
    // 2 signals from 1 plant, consented — below MIN_SIGNALS(3) / MIN_PLANTS(2).
    await seedSignal({ mfr: MFR, model: "M1", cat: "cooling", consent: true, org: "orgA" });
    await seedSignal({ mfr: MFR, model: "M1", cat: "cooling", consent: true, org: "orgA" });
    const r = await networkIntelligence({ manufacturer: MFR, model: "M1" });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/not enough|anonymous/i);
  });

  it("aggregates once enough consented signals from enough plants exist", async () => {
    const MFR = "NetVendorB";
    await seedSignal({ mfr: MFR, model: "M2", cat: "cooling", downtime: 40, consent: true, org: "orgA" });
    await seedSignal({ mfr: MFR, model: "M2", cat: "cooling", downtime: 50, consent: true, org: "orgB" });
    await seedSignal({ mfr: MFR, model: "M2", cat: "mechanical", downtime: 120, consent: true, org: "orgC" });
    const r = await networkIntelligence({ manufacturer: MFR, model: "M2" });
    expect(r.available).toBe(true);
    expect(r.signalCount).toBe(3);
    expect(r.plantCount).toBe(3);
    expect(r.resolutionBreakdown[0].category).toBe("cooling"); // most common
    expect(r.resolutionBreakdown[0].pct).toBe(67);
    expect(r.medianDowntimeMins).toBe(50);
    // The human summary never exposes an org id.
    const s = summarizeNetwork(r);
    expect(s).not.toMatch(/org[AB C]/);
    expect(s).toContain("plants");
  });

  it("pools CONSENTED signals ONLY (non-consented are invisible)", async () => {
    const MFR = "NetVendorC";
    // 3 signals from 3 plants but NOT consented → must remain invisible.
    await seedSignal({ mfr: MFR, model: "M3", cat: "electrical", consent: false, org: "orgA" });
    await seedSignal({ mfr: MFR, model: "M3", cat: "electrical", consent: false, org: "orgB" });
    await seedSignal({ mfr: MFR, model: "M3", cat: "electrical", consent: false, org: "orgC" });
    const r = await networkIntelligence({ manufacturer: MFR, model: "M3" });
    expect(r.available).toBe(false);
    expect(r.signalCount).toBe(0);
  });

  it("never returns any tenant identifier in the result object", async () => {
    const MFR = "NetVendorD";
    for (const org of ["orgA", "orgB", "orgC"]) await seedSignal({ mfr: MFR, model: "M4", cat: "controls", consent: true, org });
    const r = await networkIntelligence({ manufacturer: MFR, model: "M4" });
    const json = JSON.stringify(r);
    expect(json).not.toContain("orgA");
    expect(json).not.toContain("originOrgId");
    expect(r.available).toBe(true);
  });

  it("requires at least one OEM dimension", async () => {
    const r = await networkIntelligence({});
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/manufacturer|model|fault/i);
  });
});
