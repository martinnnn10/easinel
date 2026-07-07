import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { audit, emitEvent } from "@/lib/events";
import { listAuditLog, auditLogCsv, auditLabel, auditCategory } from "./query";

const ORG = "org_audit";

beforeAll(async () => {
  await ensureDb();
  await db.insert(users).values([
    { id: "u_maria", orgId: ORG, email: "maria@plant.com", name: "Maria Diaz", role: "manager" },
  ]);
  // Attributed by id, by email, and a system actor.
  await audit(ORG, "u_maria", "workorder.created", "wo_1", { title: "F007" });
  await audit(ORG, "maria@plant.com", "pm.approved", "pm_9", { title: "Monthly" });
  await audit(ORG, "system", "memory.captured", "wo_1", {});
  // Another org — must never appear.
  await audit("org_other", "someone", "workorder.created", "wo_x", {});
});

describe("listAuditLog", () => {
  it("resolves actors (id and email) to names; labels system honestly", async () => {
    const rows = await listAuditLog(ORG, {});
    const wo = rows.find((r) => r.action === "workorder.created")!;
    const pm = rows.find((r) => r.action === "pm.approved")!;
    const sys = rows.find((r) => r.action === "memory.captured")!;
    expect(wo.actorName).toBe("Maria Diaz");
    expect(pm.actorName).toBe("Maria Diaz"); // resolved via email
    expect(sys.actorName).toBe("System");
    expect(wo.label).toBe("Created work order");
    expect(pm.category).toBe("pm");
  });

  it("filters by target (per-record history)", async () => {
    const rows = await listAuditLog(ORG, { target: "wo_1" });
    expect(rows).toHaveLength(2); // created + memory.captured
    expect(rows.every((r) => r.target === "wo_1")).toBe(true);
  });

  it("filters by category", async () => {
    const rows = await listAuditLog(ORG, { category: "pm" });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("pm.approved");
  });

  it("is tenant-scoped — never returns another org's events", async () => {
    const rows = await listAuditLog(ORG, {});
    expect(rows.every((r) => r.target !== "wo_x")).toBe(true);
    const other = await listAuditLog("org_none", {});
    expect(other).toHaveLength(0);
  });

  it("excludes the event.* webhook mirror rows (no double-counting)", async () => {
    // emitEvent writes both an events row AND an audit_log 'event.*' mirror.
    await emitEvent(ORG, "asset.created", { id: "ast_mirror" });
    const rows = await listAuditLog(ORG, {});
    expect(rows.some((r) => r.action.startsWith("event."))).toBe(false);
  });
});

describe("category filter honours limit correctly", () => {
  it("returns matching-category rows even when newer other-category rows exceed the limit", async () => {
    const O = "org_audit_cat";
    // 5 newer work-order events, then 1 older PM event.
    for (let i = 0; i < 5; i++) await audit(O, "system", "workorder.created", `wo_${i}`, {});
    await audit(O, "system", "pm.approved", "pm_old", { title: "Old PM" });
    // Ask for PM category with a small limit. The PM row is the OLDEST, so a
    // naive "limit then filter" would fetch the 5 newest (all work orders) and
    // return zero PM rows. The fix filters first, then slices.
    const rows = await listAuditLog(O, { category: "pm", limit: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("pm.approved");
  });
});

describe("auditLogCsv", () => {
  it("produces a header + one row per entry, escaping quotes", async () => {
    const rows = await listAuditLog(ORG, {});
    const csv = auditLogCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Timestamp");
    expect(lines.length).toBe(rows.length + 1);
    expect(csv).toContain("Maria Diaz");
  });

  it("neutralizes CSV formula injection in detail fields", () => {
    const csv = auditLogCsv([
      { id: "a", at: 0, actor: "x", actorName: "=cmd|' /c calc'", action: "asset.updated", label: "Updated asset", category: "asset", target: "t", detail: "@SUM(A1)" },
    ]);
    // Both the leading "=" name and "@" detail get an apostrophe prefix.
    expect(csv).toContain(`"'=cmd`);
    expect(csv).toContain(`"'@SUM(A1)"`);
  });
});

describe("label + category fallbacks", () => {
  it("de-underscores unknown actions and categorizes by head", () => {
    expect(auditLabel("widget.frobnicated")).toBe("widget frobnicated");
    expect(auditCategory("workorder.created")).toBe("work_order");
    expect(auditCategory("mystery.thing")).toBe("other");
  });
});
