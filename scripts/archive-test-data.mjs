/**
 * archive-test-data.mjs — one-time, ID-scoped cleanup of owner-created test
 * records in the production org. ARCHIVES ONLY — nothing is deleted, every
 * record stays in the database and remains recoverable.
 *
 * What it does (and nothing else):
 *   • 2 assets  → status 'retired'   (hidden from the default Equipment view;
 *                                     visible again via the "Retired" filter)
 *   • 5 PMs     → status 'archived'  (hidden from the PM Program default view;
 *                                     visible under the "Archived" tab)
 *   • their pm_schedules → active=0  (mirrors archiveProgram() so nothing fires)
 *   • 1 work order → NO state change (already status 'done'; done WOs never
 *                                     appear in active work views. There is no
 *                                     archived state in the WO state machine,
 *                                     so it is left as a closed record.)
 *   • audit_log → one row per record: "Archived as owner-created test data cleanup."
 *
 * Safety:
 *   • Every statement is scoped to BOTH the exact record id AND the org id.
 *   • No name-based matching is used for writes — names are only used as a
 *     preflight assertion that we are pointing at the right database.
 *   • DRY-RUN by default. Run with --apply to execute. Idempotent — safe to
 *     re-run; already-archived records are simply reported as such.
 *
 * Usage (from the app root on the production VM):
 *   node scripts/archive-test-data.mjs            # dry-run: shows current state
 *   node scripts/archive-test-data.mjs --apply    # performs the archive
 *
 * DATABASE_URL is honored exactly like the app (defaults to file:local.db).
 *
 * To REVERSE (recover) later, run against the same DB:
 *   UPDATE assets      SET status='operational' WHERE org_id='<ORG>' AND id IN ('<asset ids>');
 *   UPDATE pm_programs SET status='draft'       WHERE org_id='<ORG>' AND id IN ('<pm ids>');
 *   UPDATE pm_schedules SET active=1 WHERE org_id='<ORG>' AND pm_program_id IN ('<pm ids>');
 *   UPDATE documents   SET archived_at=NULL     WHERE org_id='<ORG>' AND id IN ('<doc ids>');
 *   UPDATE invitations SET status='pending'     WHERE org_id='<ORG>' AND id IN ('<invite ids>');
 *
 * ── Two passes ─────────────────────────────────────────────────────────────
 * PASS 1 (exact-ID): the records whose IDs were verified against the 2026-07-05
 *   export — 2 assets, 5 "Test VFD" PMs, 1 work order. Matched on id + org.
 * PASS 2 (discovery): items the 2026-07-06 Production Trust Audit surfaced whose
 *   exact IDs we don't have yet — a "Test Conveyor" PM, three "test_upload_audit
 *   .pdf" uploads, and the test@example.com / test2@example.com invitations.
 *   These are matched by name/filename/email WITHIN THE PRODUCTION ORG ONLY, and
 *   every candidate is printed for review in dry-run before any write. All
 *   actions are archive/revoke (reversible) — never a delete.
 */
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL ?? "file:local.db";
const db = createClient({ url });

// ── The exact records. IDs verified against the live DB export of 2026-07-05.
const ORG = "org_32458f29-29a6-4de2-b609-9880bcab4e6f";

const ASSETS = [
  { id: "ast_8b6a6cb8-d325-4cf7-becd-b3976c2665a0", name: "Test Conveyor - Audit" },
  { id: "ast_3189bd5a-b489-45a0-a95e-efb534325a4e", name: "Test VFD" },
];
const PMS = [
  { id: "pm_3fced47e-8340-4926-99b6-f686e96b3716", name: "30-Day PM — Test VFD" },
  { id: "pm_32374e48-23f2-4728-869f-68da4da56533", name: "60-Day PM — Test VFD" },
  { id: "pm_7c43bc1c-208b-40ea-a740-a680522a476a", name: "90-Day PM — Test VFD" },
  { id: "pm_6fb86d3d-d10d-4ade-b604-482d35de1bc2", name: "Semi-Annual PM — Test VFD" },
  { id: "pm_22fd1114-96d9-4897-ac80-15d52a86825c", name: "Annual PM — Test VFD" },
];
const WOS = [
  { id: "wo_6e25c91e-528b-40be-b781-52010c8500dd", name: "VFD on conveyor keeps tripping after 10 minutes of running" },
];

// ── PASS 2 (discovery). Items from the 2026-07-06 audit whose exact IDs we don't
// have. Matched by value, scoped to the production org, printed before any write.
const DISCOVER_PM_TITLES = ["Test Conveyor"];        // pm_programs.title LIKE '%…%'
const DISCOVER_DOC_FILENAMES = ["test_upload_audit.pdf"]; // documents.filename = …
const DISCOVER_INVITE_EMAILS = ["test@example.com", "test2@example.com"];

const AUDIT_NOTE = "Archived as owner-created test data cleanup.";
const ACTOR = "cleanup-script (approved by owner)";

const one = async (sql, args) => (await db.execute({ sql, args })).rows[0];

// ── Preflight: every record must exist, in this org, with the expected name.
// This is a read-only assertion that we're pointing at the right database —
// writes below never match on names.
let fail = 0;
const check = async (table, nameCol, rec) => {
  const row = await one(
    `SELECT ${nameCol} AS name, status FROM ${table} WHERE id = ? AND org_id = ?`,
    [rec.id, ORG]
  );
  if (!row) {
    console.error(`  ✗ MISSING  ${table} ${rec.id} (expected "${rec.name}") — wrong DB?`);
    fail++;
    return null;
  }
  if (row.name !== rec.name) {
    console.error(`  ✗ MISMATCH ${table} ${rec.id}: found "${row.name}", expected "${rec.name}" — aborting.`);
    fail++;
    return null;
  }
  console.log(`  ✓ ${table} ${rec.id}  "${row.name}"  status=${row.status}`);
  return row;
};

console.log(`\nDatabase: ${url}\nMode: ${APPLY ? "APPLY" : "DRY-RUN (no writes; use --apply to execute)"}\n`);
console.log("Preflight — verifying the exact records:");
for (const a of ASSETS) await check("assets", "name", a);
for (const p of PMS) await check("pm_programs", "title", p);
for (const w of WOS) await check("work_orders", "title", w);

if (fail > 0) {
  console.error(`\nAborting: ${fail} record(s) missing or mismatched. No writes performed.`);
  process.exit(1);
}

// ── PASS 2 discovery — collect candidate rows by value, scoped to the org.
const rowsOf = async (sql, args) => (await db.execute({ sql, args })).rows;

console.log("\nDiscovery — audit items matched by value (org-scoped):");

// "Test Conveyor" PM(s): active (non-archived) programs only.
const discoveredPms = [];
for (const t of DISCOVER_PM_TITLES) {
  const rows = await rowsOf(
    "SELECT id, title, status FROM pm_programs WHERE org_id = ? AND title LIKE ? AND status != 'archived'",
    [ORG, `%${t}%`]
  );
  for (const r of rows) {
    console.log(`  • PM        ${r.id}  "${r.title}"  status=${r.status}  → archive`);
    discoveredPms.push(r);
  }
}

// "test_upload_audit.pdf" uploads: not-yet-archived documents.
const discoveredDocs = [];
for (const f of DISCOVER_DOC_FILENAMES) {
  const rows = await rowsOf(
    "SELECT id, filename FROM documents WHERE org_id = ? AND filename = ? AND archived_at IS NULL",
    [ORG, f]
  );
  for (const r of rows) {
    console.log(`  • Document  ${r.id}  "${r.filename}"  → archive (hide + drop from retrieval)`);
    discoveredDocs.push(r);
  }
}

// Test invitations: only pending ones (accepted/revoked left untouched).
const discoveredInvites = [];
for (const e of DISCOVER_INVITE_EMAILS) {
  const rows = await rowsOf(
    "SELECT id, email, status FROM invitations WHERE org_id = ? AND email = ? AND status = 'pending'",
    [ORG, e]
  );
  for (const r of rows) {
    console.log(`  • Invite    ${r.id}  ${r.email}  status=${r.status}  → revoke`);
    discoveredInvites.push(r);
  }
}

if (!discoveredPms.length && !discoveredDocs.length && !discoveredInvites.length) {
  console.log("  (none found — already cleaned up, or different DB)");
}

if (!APPLY) {
  console.log("\nDry-run complete. Re-run with --apply to archive/revoke everything above.");
  process.exit(0);
}

// ── Apply — a single transaction; each statement scoped to id + org_id.
const now = Date.now();
const tx = await db.transaction("write");
try {
  for (const a of ASSETS) {
    await tx.execute({
      sql: "UPDATE assets SET status = 'retired', updated_at = ? WHERE id = ? AND org_id = ?",
      args: [now, a.id, ORG],
    });
    await tx.execute({
      sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?, ?, ?, 'asset.retired', ?, ?, ?)",
      args: [`aud_${randomUUID()}`, ORG, ACTOR, a.id, AUDIT_NOTE, now],
    });
  }
  for (const p of PMS) {
    await tx.execute({
      sql: "UPDATE pm_programs SET status = 'archived', updated_at = ? WHERE id = ? AND org_id = ?",
      args: [now, p.id, ORG],
    });
    // Mirror archiveProgram(): an archived PM must never keep a live schedule.
    await tx.execute({
      sql: "UPDATE pm_schedules SET active = 0 WHERE pm_program_id = ? AND org_id = ?",
      args: [p.id, ORG],
    });
    await tx.execute({
      sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?, ?, ?, 'pm.archived', ?, ?, ?)",
      args: [`aud_${randomUUID()}`, ORG, ACTOR, p.id, AUDIT_NOTE, now],
    });
  }
  for (const w of WOS) {
    // No state change — already done. Audit row records the decision.
    await tx.execute({
      sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?, ?, ?, 'workorder.test-data-note', ?, ?, ?)",
      args: [`aud_${randomUUID()}`, ORG, ACTOR, w.id, AUDIT_NOTE, now],
    });
  }
  // ── PASS 2 (discovery) — archive PMs/docs, revoke invitations. Reversible.
  for (const p of discoveredPms) {
    await tx.execute({
      sql: "UPDATE pm_programs SET status = 'archived', updated_at = ? WHERE id = ? AND org_id = ?",
      args: [now, p.id, ORG],
    });
    await tx.execute({
      sql: "UPDATE pm_schedules SET active = 0 WHERE pm_program_id = ? AND org_id = ?",
      args: [p.id, ORG],
    });
    await tx.execute({
      sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?, ?, ?, 'pm.archived', ?, ?, ?)",
      args: [`aud_${randomUUID()}`, ORG, ACTOR, p.id, AUDIT_NOTE, now],
    });
  }
  for (const d of discoveredDocs) {
    // Hide from the Knowledge base and exclude its chunks from retrieval; the
    // row and chunks are kept (clear archived_at to restore).
    await tx.execute({
      sql: "UPDATE documents SET archived_at = ? WHERE id = ? AND org_id = ?",
      args: [now, d.id, ORG],
    });
    await tx.execute({
      sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?, ?, ?, 'document.archived', ?, ?, ?)",
      args: [`aud_${randomUUID()}`, ORG, ACTOR, d.id, AUDIT_NOTE, now],
    });
  }
  for (const i of discoveredInvites) {
    // Revoke (not delete) — disappears from the pending list; recoverable.
    await tx.execute({
      sql: "UPDATE invitations SET status = 'revoked' WHERE id = ? AND org_id = ? AND status = 'pending'",
      args: [i.id, ORG],
    });
    await tx.execute({
      sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?, ?, ?, 'invitation.revoked', ?, ?, ?)",
      args: [`aud_${randomUUID()}`, ORG, ACTOR, i.id, AUDIT_NOTE, now],
    });
  }
  await tx.commit();
} catch (e) {
  await tx.rollback();
  console.error("Transaction failed — rolled back, nothing changed:", e.message);
  process.exit(1);
}

// ── Post-verification.
console.log("\nApplied. Post-verification:");
for (const a of ASSETS) await check("assets", "name", a);
for (const p of PMS) await check("pm_programs", "title", p);
const sched = await one(
  `SELECT COUNT(*) AS n FROM pm_schedules WHERE org_id = ? AND active = 1 AND pm_program_id IN (${PMS.map(() => "?").join(",")})`,
  [ORG, ...PMS.map((p) => p.id)]
);
console.log(`  active schedules remaining on archived PMs: ${sched.n} (expected 0)`);
// Discovered items: confirm they're now hidden.
for (const d of discoveredDocs) {
  const row = await one("SELECT archived_at FROM documents WHERE id = ? AND org_id = ?", [d.id, ORG]);
  console.log(`  document ${d.id} archived_at set: ${row?.archived_at ? "yes" : "NO"}`);
}
for (const i of discoveredInvites) {
  const row = await one("SELECT status FROM invitations WHERE id = ? AND org_id = ?", [i.id, ORG]);
  console.log(`  invitation ${i.id} (${i.email}) status: ${row?.status}`);
}
const expectedAudits =
  ASSETS.length + PMS.length + WOS.length +
  discoveredPms.length + discoveredDocs.length + discoveredInvites.length;
const audits = await one(
  "SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ? AND detail = ? AND at = ?",
  [ORG, AUDIT_NOTE, now]
);
console.log(`  audit_log rows written this run: ${audits.n} (expected ${expectedAudits})`);
console.log("\nDone. Records are archived/revoked, not deleted — see the file header for recovery SQL.");
