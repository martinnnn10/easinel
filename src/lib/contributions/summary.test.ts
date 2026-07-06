import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { audit } from "@/lib/events";
import { getContributions } from "./summary";

const ORG = "org_contrib";

beforeAll(async () => {
  await ensureDb();
  // Two real users. Note the actor inconsistency we must tolerate: some call
  // sites log the user id, others the email.
  await db.insert(users).values([
    { id: "u_maria", orgId: ORG, email: "maria@plant.com", name: "Maria Diaz", role: "technician" },
    { id: "u_jose", orgId: ORG, email: "jose@plant.com", name: "Jose Park", role: "manager" },
  ]);

  // Maria — the knowledge sharer (attributed by user id).
  await audit(ORG, "u_maria", "scenario.created", "s1", { title: "F007 fix" });
  await audit(ORG, "u_maria", "scenario.created", "s2", { title: "belt tracking" });
  await audit(ORG, "u_maria", "rca.saved", "r1", { confidence: 0.8 });
  await audit(ORG, "u_maria", "workorder.status_changed", "w1", { from: "in_progress", to: "done" });
  await audit(ORG, "u_maria", "workorder.created", "w1", {});

  // Jose — approvals + PMs (attributed by EMAIL, different call sites).
  await audit(ORG, "jose@plant.com", "pm.approved", "p1", { title: "Monthly" });
  await audit(ORG, "jose@plant.com", "workorder.approved", "w9", {});
  await audit(ORG, "jose@plant.com", "pm.created", "p2", {});

  // System capture — must NOT be credited to any person.
  await audit(ORG, "system", "memory.captured", "d1", {});
  // An in-progress status change is not a closed repair.
  await audit(ORG, "u_maria", "workorder.status_changed", "w2", { from: "open", to: "in_progress" });
});

describe("getContributions", () => {
  it("credits actions to the right person across id- and email-based actors", async () => {
    const c = await getContributions(ORG, 90);
    const maria = c.people.find((p) => p.userId === "u_maria")!;
    const jose = c.people.find((p) => p.userId === "u_jose")!;
    expect(maria.counts.scenariosShared).toBe(2);
    expect(maria.counts.rcasSaved).toBe(1);
    expect(maria.counts.repairsClosed).toBe(1); // only the → done one
    expect(maria.counts.workOrdersLogged).toBe(1);
    expect(jose.counts.approvals).toBe(2); // pm.approved + workorder.approved
    expect(jose.counts.pmsCreated).toBe(1);
  });

  it("ranks the knowledge sharer first", async () => {
    const c = await getContributions(ORG, 90);
    expect(c.people[0].userId).toBe("u_maria");
    expect(c.people[0].knowledgeShared).toBe(4); // 2 scenarios + 1 rca + 1 repair
  });

  it("never credits system/unattributed actions to a person", async () => {
    const c = await getContributions(ORG, 90);
    // memory.captured isn't a recognized category, so it isn't counted at all;
    // no phantom person appears and no real user is credited for it.
    expect(c.people.every((p) => p.total > 0)).toBe(true);
    expect(c.people.find((p) => p.name === "system")).toBeUndefined();
  });

  it("is tenant-scoped and honest-empty for a fresh org", async () => {
    const c = await getContributions("org_none", 90);
    expect(c.hasData).toBe(false);
    expect(c.people).toHaveLength(0);
    expect(c.totalCredited).toBe(0);
  });
});
