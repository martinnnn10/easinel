import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL so the repository exercises the real SQL path.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createWorkOrderRequest,
  approveRequest,
  rejectRequest,
  listRequests,
  listWorkOrders,
  countPendingRequests,
} from "./repository";

const ORG = "org_appr_test";
const OTHER = "org_appr_other";

describe("work order request → approval workflow", () => {
  beforeAll(async () => {
    await listWorkOrders(ORG); // ensure schema created
  });

  it("a request is created pending and stays OFF the active board", async () => {
    const req = await createWorkOrderRequest(
      ORG,
      { symptom: "Air leak on Line A palletizer clamp", area: "Line A", priority: "medium" },
      "tech_jane"
    );
    expect(req.approvalStatus).toBe("pending");
    expect(req.requestedBy).toBe("tech_jane");
    // Area folded into description when no specific asset.
    expect(req.description ?? "").toContain("Line A");

    // Active board (default approved-only) must NOT include the pending request.
    const board = await listWorkOrders(ORG);
    expect(board.find((w) => w.id === req.id)).toBeUndefined();

    // Approvals queue DOES include it.
    const pending = await listRequests(ORG, "pending");
    expect(pending.find((w) => w.id === req.id)).toBeTruthy();
    expect(await countPendingRequests(ORG)).toBeGreaterThanOrEqual(1);
  });

  it("approving a request promotes it onto the active board", async () => {
    const req = await createWorkOrderRequest(
      ORG,
      { symptom: "Replace worn V-belt on exhaust fan", priority: "high" },
      "tech_bob"
    );
    const approved = await approveRequest(ORG, req.id, "mgr_sue", "Go ahead");
    expect(approved?.approvalStatus).toBe("approved");
    expect(approved?.approvedBy).toBe("mgr_sue");
    expect(approved?.status).toBe("open");

    const board = await listWorkOrders(ORG);
    expect(board.find((w) => w.id === req.id)).toBeTruthy();

    // No longer pending.
    const pending = await listRequests(ORG, "pending");
    expect(pending.find((w) => w.id === req.id)).toBeUndefined();
  });

  it("rejecting a request keeps it off the board with a reason", async () => {
    const req = await createWorkOrderRequest(
      ORG,
      { symptom: "Repaint handrail (cosmetic)", priority: "low" },
      "tech_amy"
    );
    const rejected = await rejectRequest(ORG, req.id, "mgr_sue", "Not maintenance scope");
    expect(rejected?.approvalStatus).toBe("rejected");
    expect(rejected?.rejectionReason).toBe("Not maintenance scope");

    const board = await listWorkOrders(ORG);
    expect(board.find((w) => w.id === req.id)).toBeUndefined();

    const rejectedList = await listRequests(ORG, "rejected");
    expect(rejectedList.find((w) => w.id === req.id)).toBeTruthy();
  });

  it("requests are tenant-isolated", async () => {
    const req = await createWorkOrderRequest(
      OTHER,
      { symptom: "Other-org request", priority: "medium" },
      "tech_other"
    );
    // The original org's pending queue must never see another org's request.
    const pending = await listRequests(ORG, "pending");
    expect(pending.find((w) => w.id === req.id)).toBeUndefined();
    // And approving in the wrong org must not find it.
    const wrong = await approveRequest(ORG, req.id, "mgr_sue");
    expect(wrong).toBeUndefined();
  });
});
