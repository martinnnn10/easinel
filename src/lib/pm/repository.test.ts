import { describe, it, expect } from "vitest";

// In-memory libSQL so the repository exercises the real SQL path. Set BEFORE
// importing the db module.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createProgram,
  approveProgram,
  listPrograms,
  getProgram,
  recordCompletion,
  archiveProgram,
} from "./repository";

const ORG = "org_test";

describe("PM program lifecycle", () => {
  it("AI-suggested programs are created as draft, never auto-active", async () => {
    const pm = await createProgram(
      ORG,
      {
        title: "PM — bearing seizure (Line 3)",
        failureMode: "bearing seizure",
        intervalDays: 90,
        source: "ai_suggested",
        tasks: ["LOTO", "Inspect bearing", "Re-grease"],
        evidence: [{ kind: "work_order", refId: "wo_1", detail: "WO-1 bearing failure" }],
      },
      "ai"
    );
    expect(pm.status).toBe("draft");
    expect(pm.source).toBe("ai_suggested");

    const detail = await getProgram(ORG, pm.id);
    expect(detail?.tasks.length).toBe(3);
    expect(detail?.evidence.length).toBe(1);
    expect(detail?.schedule).toBeNull(); // no schedule until approved
  });

  it("approval activates the program and creates a future-dated schedule", async () => {
    const pm = await createProgram(ORG, { title: "PM — monthly belt check", intervalDays: 30 }, "mgr");
    const approved = await approveProgram(ORG, pm.id, "manager@plant.com");
    expect(approved?.status).toBe("active");
    expect(approved?.approvedBy).toBe("manager@plant.com");

    const detail = await getProgram(ORG, pm.id);
    expect(detail?.schedule).not.toBeNull();
    expect(detail?.schedule?.active).toBe(true);
    expect(detail?.schedule?.nextDueAt).toBeGreaterThan(Date.now());
  });

  it("filters programs by status", async () => {
    const drafts = await listPrograms(ORG, "draft");
    const actives = await listPrograms(ORG, "active");
    expect(drafts.every((p) => p.status === "draft")).toBe(true);
    expect(actives.every((p) => p.status === "active")).toBe(true);
  });

  it("recording a completion advances the next due date", async () => {
    const pm = await createProgram(ORG, { title: "PM — quarterly inspection", intervalDays: 90 }, "mgr");
    await approveProgram(ORG, pm.id, "mgr");
    const before = (await getProgram(ORG, pm.id))?.schedule?.nextDueAt ?? 0;
    await recordCompletion(ORG, pm.id, { status: "done", completedBy: "tech@plant.com" }, "tech@plant.com");
    const after = await getProgram(ORG, pm.id);
    expect(after?.completions.length).toBe(1);
    expect(after?.completions[0].status).toBe("done");
    expect(after?.schedule?.nextDueAt).toBeGreaterThanOrEqual(before);
  });

  it("archiving deactivates the schedule", async () => {
    const pm = await createProgram(ORG, { title: "PM — to archive", intervalDays: 30 }, "mgr");
    await approveProgram(ORG, pm.id, "mgr");
    await archiveProgram(ORG, pm.id, "mgr");
    const detail = await getProgram(ORG, pm.id);
    expect(detail?.status).toBe("archived");
    expect(detail?.schedule?.active).toBe(false);
  });
});
