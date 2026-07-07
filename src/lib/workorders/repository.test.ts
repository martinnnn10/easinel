import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL so the repository exercises the real SQL path. Set BEFORE
// importing the db module. A future Postgres swap reuses these same assertions.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  canTransition,
  isOpenStatus,
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  transitionWorkOrder,
  listWorkOrderEvents,
  updateWorkOrder,
  deleteWorkOrder,
  workOrderStats,
} from "./repository";
import { createAsset } from "@/lib/assets/repository";
import { db } from "@/lib/db";
import { oemFailureSignals } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
const ORG = "org_test";

describe("work order state machine (pure)", () => {
  it("allows valid transitions", () => {
    expect(canTransition("open", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "done")).toBe(true);
    expect(canTransition("on_hold", "in_progress")).toBe(true);
    expect(canTransition("done", "open")).toBe(true); // reopen
  });
  it("rejects illegal transitions", () => {
    expect(canTransition("open", "synced_nonsense")).toBe(false);
    expect(canTransition("done", "in_progress")).toBe(false); // must reopen first
  });
  it("treats same-state as a no-op (idempotent)", () => {
    expect(canTransition("open", "open")).toBe(true);
  });
  it("classifies open vs terminal states", () => {
    expect(isOpenStatus("open")).toBe(true);
    expect(isOpenStatus("in_progress")).toBe(true);
    expect(isOpenStatus("done")).toBe(false);
    expect(isOpenStatus("synced")).toBe(false);
  });
});

describe("work order lifecycle (integration)", () => {
  beforeAll(async () => {
    await listWorkOrders(ORG); // ensure schema created
  });

  it("creates a work order in the open state with a created event", async () => {
    const wo = await createWorkOrder(
      ORG,
      { title: "Pump 12 leaking", symptom: "Seal weeping", priority: "high" },
      "tester"
    );
    expect(wo.status).toBe("open");
    expect(wo.reportedAt).toBeTruthy();
    const events = await listWorkOrderEvents(ORG, wo.id);
    expect(events.some((e) => e.kind === "created")).toBe(true);
  });

  it("walks open → in_progress → done, stamping downtime and history", async () => {
    const wo = await createWorkOrder(ORG, { title: "Line stop", type: "corrective" }, "tester");
    const start = await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "tester" });
    expect(start.workOrder?.status).toBe("in_progress");
    expect(start.workOrder?.startedAt).toBeTruthy();

    const close = await transitionWorkOrder(ORG, wo.id, "done", {
      resolution: "Replaced contactor",
      actor: "tester",
    });
    expect(close.workOrder?.status).toBe("done");
    expect(close.workOrder?.closedAt).toBeTruthy();
    expect(Number(close.workOrder?.downtimeMins)).toBeGreaterThanOrEqual(1);

    const events = await listWorkOrderEvents(ORG, wo.id);
    // created + in_progress + done = 3 status/created events
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects an illegal transition with an error (no state change)", async () => {
    const wo = await createWorkOrder(ORG, { title: "Bad path" }, "tester");
    await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "tester" });
    await transitionWorkOrder(ORG, wo.id, "done", { actor: "tester" });
    // done -> in_progress is illegal (must reopen first)
    const bad = await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "tester" });
    expect(bad.error).toBeTruthy();
    const fresh = await getWorkOrder(ORG, wo.id);
    expect(fresh?.status).toBe("done");
  });

  it("edits fields and records an assignment event", async () => {
    const wo = await createWorkOrder(ORG, { title: "Assign me" }, "tester");
    await updateWorkOrder(ORG, wo.id, { assignedTo: "Mike R." }, "tester");
    const events = await listWorkOrderEvents(ORG, wo.id);
    expect(events.some((e) => e.kind === "assignment")).toBe(true);
  });

  it("computes stats over closed corrective work orders", async () => {
    const stats = await workOrderStats(ORG);
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.avgDowntimeMins).not.toBeNull();
  });

  it("deletes a work order and its history", async () => {
    const wo = await createWorkOrder(ORG, { title: "Delete me" }, "tester");
    const ok = await deleteWorkOrder(ORG, wo.id, "tester");
    expect(ok).toBe(true);
    expect(await getWorkOrder(ORG, wo.id)).toBeUndefined();
    expect((await listWorkOrderEvents(ORG, wo.id)).length).toBe(0);
  });
});

describe("moat-aware OEM failure signal (Decision 3)", () => {
  it("emits an anonymized OEM-level signal on close — no tenant identifiers, consent off by default", async () => {
    // Asset with an OEM identity (make/model) so a signal is poolable.
    const asset = await createAsset(
      ORG,
      {
        name: "VFD Test Drive",
        manufacturer: "Allen-Bradley",
        model: "PowerFlex 525",
        assetType: "vfd",
      },
      "tester"
    );
    const wo = await createWorkOrder(
      ORG,
      {
        title: "Drive fault F007",
        symptom: "F007 overload after warmup",
        assetId: asset.id,
        type: "corrective",
      },
      "tester"
    );
    await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "tester" });
    await transitionWorkOrder(ORG, wo.id, "done", {
      resolution: "Replaced clogged panel cooling filter",
      actor: "tester",
    });

    const signals = await db
      .select()
      .from(oemFailureSignals)
      .where(and(eq(oemFailureSignals.manufacturer, "Allen-Bradley")));
    expect(signals.length).toBeGreaterThan(0);
    const sig = signals[0];
    // Poolable OEM dimensions are present...
    expect(sig.model).toBe("PowerFlex 525");
    expect(sig.faultCode).toBe("F007");
    // ...the resolution was classified to a coarse, non-identifying category...
    expect(sig.resolutionCategory).toBe("cooling");
    // ...consent is OFF by default (pooling stays dark until contractually enabled)...
    expect(sig.sharedConsent).toBe(false);
    // ...and the signal row carries NO free text / asset id / plant identifiers.
    expect(Object.keys(sig)).not.toContain("symptom");
    expect(Object.keys(sig)).not.toContain("resolution");
    expect(Object.keys(sig)).not.toContain("assetId");
  });

  it("does not emit a signal for an asset with no OEM identity", async () => {
    const asset = await createAsset(ORG, { name: "Mystery Machine" }, "tester");
    const before = (await db.select().from(oemFailureSignals)).length;
    const wo = await createWorkOrder(
      ORG,
      { title: "Generic fix", assetId: asset.id, type: "corrective" },
      "tester"
    );
    await transitionWorkOrder(ORG, wo.id, "done", { resolution: "tightened a bolt", actor: "tester" });
    const after = (await db.select().from(oemFailureSignals)).length;
    expect(after).toBe(before);
  });
});

// Concurrency + idempotency of the state machine. Uses a UNIQUE manufacturer so
// the emitted OEM signals never collide with other files' manufacturer-scoped
// assertions (the in-memory DB is shared across test files).
describe("work order transition — idempotency & concurrency", () => {
  // Each test uses a DISTINCT manufacturer: the in-memory DB is shared across
  // tests, and signalCount() counts by manufacturer, so a shared vendor would let
  // one test's emitted signal leak into another's count.
  async function correctiveWO(mfr: string) {
    const asset = await createAsset(
      ORG,
      { name: "Conc Machine", manufacturer: mfr, model: "CT-1", assetType: "pump" },
      "tester"
    );
    const wo = await createWorkOrder(
      ORG,
      { title: "Conc test", symptom: "F007 overload", assetId: asset.id, type: "corrective" },
      "tester"
    );
    await transitionWorkOrder(ORG, wo.id, "in_progress", { actor: "tester" });
    return wo;
  }
  const signalCount = async (mfr: string) =>
    (await db.select().from(oemFailureSignals).where(eq(oemFailureSignals.manufacturer, mfr))).length;

  it("treats a repeat →done as a no-op: no re-stamped close, no duplicate signal", async () => {
    const MFR = "ConcIdempotencyCo";
    const wo = await correctiveWO(MFR);
    const first = await transitionWorkOrder(ORG, wo.id, "done", { resolution: "replaced seal", actor: "t" });
    expect(first.workOrder?.status).toBe("done");
    const closedAt = first.workOrder?.closedAt;
    const afterOne = await signalCount(MFR);
    expect(afterOne).toBe(1);

    // Second identical close — must NOT re-run close-out side effects.
    const second = await transitionWorkOrder(ORG, wo.id, "done", { resolution: "again", actor: "t" });
    expect(second.error).toBeUndefined();
    expect(second.workOrder?.status).toBe("done");
    expect(second.workOrder?.closedAt).toEqual(closedAt); // unchanged
    expect(await signalCount(MFR)).toBe(1); // NOT 2
  });

  it("survives two concurrent closes with exactly one real transition (one signal)", async () => {
    const MFR = "ConcRaceCo";
    const wo = await correctiveWO(MFR);
    const results = await Promise.all([
      transitionWorkOrder(ORG, wo.id, "done", { resolution: "tech A fix", actor: "A" }),
      transitionWorkOrder(ORG, wo.id, "done", { resolution: "tech B fix", actor: "B" }),
    ]);
    // Final state is consistent.
    const fresh = await getWorkOrder(ORG, wo.id);
    expect(fresh?.status).toBe("done");
    // Exactly one anonymized OEM signal was emitted, regardless of interleaving —
    // the moat is never double-counted and downtime is stamped once.
    expect(await signalCount(MFR)).toBe(1);
    // At least one call reports success; any loser is a clean conflict, never a crash.
    const successes = results.filter((r) => r.workOrder && !r.error);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      if (r.error) expect(r.error).toBe("concurrent_modification");
    }
  });
});

describe("createWorkOrder org-isolation guard", () => {
  it("keeps a valid same-org assetId", async () => {
    const a = await createAsset(ORG, { name: "Boiler 2" });
    const wo = await createWorkOrder(ORG, { title: "leak", symptom: "leak at flange", assetId: a.id });
    expect(wo.assetId).toBe(a.id);
  });

  it("drops a foreign/unknown assetId to null (no cross-tenant reference)", async () => {
    // An asset that belongs to a DIFFERENT org must never attach here.
    const foreign = await createAsset("org_other_tenant", { name: "Not Yours" });
    const wo = await createWorkOrder(ORG, { title: "x", symptom: "scanned a foreign tag", assetId: foreign.id });
    expect(wo.assetId).toBeNull();

    const wo2 = await createWorkOrder(ORG, { title: "y", symptom: "made-up id", assetId: "ast_does_not_exist" });
    expect(wo2.assetId).toBeNull();
  });
});
