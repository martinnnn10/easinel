import { describe, it, expect } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { pmSchedules } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { createProgram, approveProgram, recordCompletion, listDue } from "./repository";
import { id } from "@/lib/util";

const ORG = "org_pm_gate";
const ASSET = "asset_pm_gate";

describe("Fix 4 — draft PMs never generate due work", () => {
  it("listDue excludes a DRAFT program even if a stray active schedule exists", async () => {
    await ensureDb();
    // A draft program (as the manual/AI path creates it).
    const pm = await createProgram(ORG, { title: "Draft PM", assetId: ASSET, intervalDays: 30 }, "mgr");
    expect(pm.status).toBe("draft");

    // Simulate the OLD bug: a schedule row that is active and already due, but the
    // program itself was never approved. The status guard must still exclude it.
    await db.insert(pmSchedules).values({
      id: id("pms"),
      orgId: ORG,
      pmProgramId: pm.id,
      intervalDays: 30,
      nextDueAt: new Date(Date.now() - 86_400_000), // due yesterday
      active: true,
    });

    const due = await listDue(ORG);
    expect(due.find((d) => d.id === pm.id)).toBeUndefined();
  });

  it("after approval the same program DOES appear as due", async () => {
    const pm = await createProgram(ORG, { title: "To approve", assetId: ASSET, intervalDays: 30 }, "mgr");
    await approveProgram(ORG, pm.id, "mgr@plant");
    // Force its (real) schedule due now.
    await db
      .update(pmSchedules)
      .set({ nextDueAt: new Date(Date.now() - 1000) })
      .where(sql`pm_program_id = ${pm.id}`);
    const due = await listDue(ORG);
    expect(due.find((d) => d.id === pm.id)).toBeTruthy();
  });
});

describe("Fix 6 — PM completion enrichment is SQL-injection-safe", () => {
  async function completionRow(pmId: string) {
    // Raw read of the migration-added columns (not in the typed schema object).
    const rows = (await db.all(
      sql`SELECT issues_found, follow_up, duration_mins FROM pm_completions WHERE pm_program_id = ${pmId} ORDER BY completed_at DESC LIMIT 1`
    )) as { issues_found: string | null; follow_up: string | null; duration_mins: number | null }[];
    return rows[0];
  }

  it("stores an injection payload literally and does not execute it", async () => {
    const pm = await createProgram(ORG, { title: "Injection PM", assetId: ASSET, intervalDays: 30 }, "mgr");
    await approveProgram(ORG, pm.id, "mgr");
    const payload = "x'); DROP TABLE pm_completions; --";
    await recordCompletion(
      ORG,
      pm.id,
      { status: "done", issuesFound: payload, followUp: "'; DELETE FROM pm_programs; --" },
      "tech"
    );

    // The table still exists and the malicious text was bound as a parameter,
    // stored verbatim rather than executed.
    const row = await completionRow(pm.id);
    expect(row.issues_found).toBe(payload);
    expect(row.follow_up).toBe("'; DELETE FROM pm_programs; --");

    // Sanity: pm_programs was not dropped/emptied by the DELETE payload.
    const progs = (await db.all(sql`SELECT COUNT(*) as n FROM pm_programs`)) as { n: number }[];
    expect(Number(progs[0].n)).toBeGreaterThan(0);
  });

  // A fresh program per case → exactly one completion row each, so the read is
  // deterministic (no same-millisecond ordering ties between completions).
  async function durationOf(durationMins: unknown): Promise<number | null> {
    const pm = await createProgram(ORG, { title: "Duration PM", assetId: ASSET, intervalDays: 30 }, "mgr");
    await approveProgram(ORG, pm.id, "mgr");
    await recordCompletion(ORG, pm.id, { status: "done", durationMins: durationMins as number }, "tech");
    return (await completionRow(pm.id)).duration_mins;
  }

  it("validates durationMins to a non-negative integer (rejects junk)", async () => {
    // A non-numeric / malicious duration is dropped, not written.
    expect(await durationOf("5); DROP TABLE pm_completions; --")).toBeNull();
    // A valid float is rounded and stored.
    expect(await durationOf(12.7)).toBe(13);
    // A negative duration is rejected.
    expect(await durationOf(-4)).toBeNull();
  });
});
