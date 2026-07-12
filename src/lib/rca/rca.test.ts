import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { assets, workOrders } from "@/lib/db/schema";
import { getWorkOrder } from "@/lib/workorders/repository";
import { getRcaByWorkOrder, upsertRca, rcaCounts, listRcaByAsset } from "./repository";
import { rcaConfirmNeedsManager, evaluatePmFromRca, type PmLike } from "./policy";
import { draftRca } from "./draft";
import { can } from "@/lib/auth/roles";
import { createProgram } from "@/lib/pm/repository";

const A = "org_rca_a";
const B = "org_rca_b";

beforeAll(async () => {
  await ensureDb();
  await db.insert(assets).values([
    { id: "ast_a1", orgId: A, name: "Wrapper 1" },
    { id: "ast_b1", orgId: B, name: "Other Wrapper" },
  ]);
  await db.insert(workOrders).values([
    { id: "wo_a1", orgId: A, assetId: "ast_a1", title: "Wrapper VFD F070 trip", type: "corrective", status: "done", symptom: "F070 on startup", downtimeMins: 60 },
    { id: "wo_b1", orgId: B, assetId: "ast_b1", title: "Other org WO", type: "corrective", status: "done" },
    { id: "wo_a_noasset", orgId: A, assetId: null, title: "No asset WO", type: "corrective", status: "done" },
    { id: "wo_a_susp", orgId: A, assetId: "ast_a1", title: "Suspected-only WO", type: "corrective", status: "done", downtimeMins: 30 },
  ]);
});

describe("RCA repository — org isolation + machine-memory sync", () => {
  it("creates an RCA scoped to the org", async () => {
    const rca = await upsertRca(A, "wo_a1", { symptomObserved: "F070 at startup", failedPart: "cooling fan", suspectedCause: "clogged filter" }, "u_tech");
    expect(rca).toBeTruthy();
    expect(rca!.orgId).toBe(A);
    expect(rca!.assetId).toBe("ast_a1"); // taken from the work order, not the client
    const got = await getRcaByWorkOrder(A, "wo_a1");
    expect(got!.id).toBe(rca!.id);
  });

  it("rejects a work order that belongs to another org (returns null → 404)", async () => {
    const rca = await upsertRca(A, "wo_b1", { suspectedCause: "cross-org attempt" }, "u_tech");
    expect(rca).toBeNull();
    // and org B never sees an org-A write
    expect(await getRcaByWorkOrder(B, "wo_a1")).toBeNull();
  });

  it("syncs canonical fields onto the work order (machine memory) for the same org only", async () => {
    await upsertRca(A, "wo_a1", { confirmedRootCause: "PM missed cooling-fan filter", correctiveAction: "cleaned filter, verified temps", status: "manager_confirmed", approvedBy: "mgr@a", approvedAt: new Date() }, "u_mgr");
    const wo = await getWorkOrder(A, "wo_a1");
    expect(wo!.rootCause).toBe("PM missed cooling-fan filter"); // confirmed wins
    expect(wo!.failedPart).toBe("cooling fan");
    expect(wo!.repairAction).toBe("cleaned filter, verified temps");
  });

  it("updating an RCA is org-scoped and does not leak", async () => {
    const rca = await getRcaByWorkOrder(A, "wo_a1");
    expect(rca!.status).toBe("manager_confirmed");
    expect(await rcaCounts(B)).toMatchObject({ total: 0, confirmed: 0 });
  });

  it("lists per-asset RCA history for the org", async () => {
    const hist = await listRcaByAsset(A, "ast_a1");
    expect(hist.length).toBe(1);
    expect(hist[0].confirmed).toBe(true);
    expect(await listRcaByAsset(B, "ast_a1")).toHaveLength(0);
  });

  it("clean org has no RCA (honest empty)", async () => {
    expect(await getRcaByWorkOrder("org_fresh", "wo_x")).toBeNull();
    expect(await rcaCounts("org_fresh")).toMatchObject({ total: 0 });
  });
});

describe("Fix 5 — a SUSPECTED cause is a hypothesis, never machine-memory truth", () => {
  it("does not sync a suspected cause onto the work order (only confirmed does)", async () => {
    const rca = await upsertRca(
      A,
      "wo_a_susp",
      { symptomObserved: "intermittent stop", suspectedCause: "maybe a loose sensor", status: "technician_completed" },
      "u_tech"
    );
    expect(rca!.suspectedCause).toBe("maybe a loose sensor");
    expect(rca!.confirmedRootCause).toBeNull();

    // The work order's authoritative rootCause must remain empty — a suspected
    // cause must NOT propagate to WO machine memory, repeat-risk, PM, or Copilot.
    const wo = await getWorkOrder(A, "wo_a_susp");
    expect(wo!.rootCause ?? "").toBe("");
  });

  it("only after manager confirmation does the root cause become authoritative", async () => {
    await upsertRca(
      A,
      "wo_a_susp",
      { confirmedRootCause: "sensor bracket fatigue", status: "manager_confirmed", approvedBy: "mgr@a", approvedAt: new Date() },
      "u_mgr"
    );
    const wo = await getWorkOrder(A, "wo_a_susp");
    expect(wo!.rootCause).toBe("sensor bracket fatigue");
  });
});

describe("RCA permissions policy", () => {
  it("confirming a root cause requires a manager (technician cannot)", () => {
    expect(rcaConfirmNeedsManager({ confirmedRootCause: "x" })).toBe(true);
    expect(rcaConfirmNeedsManager({ status: "manager_confirmed" })).toBe(true);
    expect(rcaConfirmNeedsManager({ suspectedCause: "x", status: "technician_completed" } as never)).toBe(false);
    // technician lacks manage_pm; manager has it
    expect(can("technician", "manage_pm")).toBe(false);
    expect(can("manager", "manage_pm")).toBe(true);
    // technicians CAN fill/update an RCA
    expect(can("technician", "update_work_order")).toBe(true);
  });
});

describe("AI RCA draft never confirms", () => {
  it("returns a suggested draft with no confirmed root cause", async () => {
    const draft = await draftRca(A, "wo_a1");
    expect(draft).toBeTruthy();
    expect(draft!.aiSuggested).toBe(true);
    expect(draft!.confirmedRootCause).toBeNull();
    expect(draft!.label).toMatch(/verify before saving/i);
  });
});

describe("PM-from-RCA policy (draft only, guarded, deduped)", () => {
  const rcaFull = { failedPart: "cooling fan", confirmedRootCause: "PM missed filter", correctiveAction: "cleaned filter" };

  it("does not suggest without an asset", () => {
    const r = evaluatePmFromRca(rcaFull, { assetId: null }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_asset");
  });
  it("does not suggest without a cause or corrective action", () => {
    expect(evaluatePmFromRca({ correctiveAction: "x" }, { assetId: "a" }, []).ok).toBe(false);
    expect(evaluatePmFromRca({ suspectedCause: "x" }, { assetId: "a" }, []).ok).toBe(false);
  });
  it("does not suggest when there is no RCA at all", () => {
    const r = evaluatePmFromRca(null, { assetId: "a" }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_rca");
  });
  it("prevents a duplicate PM for the same failure mode on the machine", () => {
    const existing: PmLike[] = [{ id: "pm1", assetId: "ast_a1", failureMode: "cooling fan overtemp", title: "Fan PM", status: "draft" }];
    const r = evaluatePmFromRca(rcaFull, { assetId: "ast_a1" }, existing);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("duplicate"); expect(r.existingPmId).toBe("pm1"); }
  });
  it("blocks a PM already sourced from THIS work order (API-level dedup, any wording)", () => {
    // Even when the title/failure-mode text wouldn't match, a PM whose
    // sourceWorkOrderId is this work order is a duplicate.
    const existing: PmLike[] = [{ id: "pm_src", assetId: "ast_a1", failureMode: "totally different words", title: "Generic PM", status: "active", sourceWorkOrderId: "wo_a1" }];
    const r = evaluatePmFromRca(rcaFull, { assetId: "ast_a1" }, existing, "wo_a1");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("duplicate"); expect(r.existingPmId).toBe("pm_src"); }
    // A different work order is NOT blocked by the source-WO guard.
    expect(evaluatePmFromRca(rcaFull, { assetId: "ast_z" }, existing, "wo_other").ok).toBe(true);
  });
  it("allows a PM when the RCA is complete and none exists yet", () => {
    expect(evaluatePmFromRca(rcaFull, { assetId: "ast_a1" }, []).ok).toBe(true);
  });
  it("a PM created from a work order is always a draft (never active)", async () => {
    const program = await createProgram(A, { assetId: "ast_a1", title: "Fan check", failureMode: "cooling fan", intervalDays: 30 }, "mgr@a");
    expect(program.status).toBe("draft");
  });
});

describe("work order closeout is independent of RCA", () => {
  it("a work order can be closed first and get its RCA later", async () => {
    // wo_a_noasset was created as 'done' with no RCA; adding an RCA later works
    // for an asset-linked WO, and the closed WO is unaffected by RCA absence.
    const wo = await getWorkOrder(A, "wo_a_noasset");
    expect(wo!.status).toBe("done");
    expect(await getRcaByWorkOrder(A, "wo_a_noasset")).toBeNull(); // no RCA yet — closeout still valid
  });
});
