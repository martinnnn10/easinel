/**
 * demo-prep.mjs — clean the two things that make a live workspace read as fake:
 * archived PMs that shouldn't be, and leftover QA/test troubleshooting sessions.
 *
 * It does NOT guess. By default (dry-run) it just SHOWS you:
 *   • every archived PM in the org, with the audit-log reason it was archived
 *     (so you can tell a real "— Test VFD" cleanup from a real PM swept by
 *     mistake), and
 *   • every Copilot conversation, newest first, with a preview of the first
 *     question and its message count — so you can spot the automated QA runs.
 * Then YOU pass the exact ids to act on.
 *
 * ─ Safety ───────────────────────────────────────────────────────────────────
 *   • Requires --org <id>; prints the org name and aborts if it doesn't exist.
 *   • Every write is scoped to id + org. DRY-RUN by default (needs --apply).
 *   • Restoring a PM sets it to 'draft' (visible in the default PM view, not
 *     auto-scheduling) and writes an audit row — reversible in the UI.
 *   • Purging a session DELETES that conversation and its messages. This is the
 *     one irreversible action here; it's meant only for your own QA junk. Ids
 *     are explicit and echoed back before deletion.
 *
 * ─ Usage (from the app root; DATABASE_URL honored like the app) ───────────────
 *   node scripts/demo-prep.mjs --org <ORG>                              # report
 *   node scripts/demo-prep.mjs --org <ORG> --restore-pms pm_a,pm_b --apply
 *   node scripts/demo-prep.mjs --org <ORG> --purge-sessions cv_a,cv_b --apply
 */
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const list = (flag) => (val(flag) ? val(flag).split(",").map((s) => s.trim()).filter(Boolean) : []);
const ORG = val("--org");
const restorePms = list("--restore-pms");
const purgeSessions = list("--purge-sessions");
const url = process.env.DATABASE_URL ?? "file:local.db";

if (!ORG) { console.error("Refusing to run: pass --org <ORG_ID>. Find it with:  SELECT id, name FROM orgs;"); process.exit(1); }

const db = createClient({ url });
const one = async (sql, a) => (await db.execute({ sql, args: a })).rows[0];
const rowsOf = async (sql, a) => (await db.execute({ sql, args: a })).rows;
const now = Date.now();

console.log(`\nDatabase: ${url}\nOrg:      ${ORG}\nMode:     ${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes; add --apply)"}\n`);
const org = await one("SELECT name FROM orgs WHERE id = ?", [ORG]);
if (!org) { console.error(`Org ${ORG} not found — aborting.`); process.exit(1); }
console.log(`Target org: "${org.name}"`);

// ── Report: archived PMs with the reason they were archived ──────────────────
console.log("\n── Archived PM programs ─────────────────────────────────────────");
const archivedPms = await rowsOf("SELECT id, title, source_work_order_id FROM pm_programs WHERE org_id = ? AND status = 'archived' ORDER BY updated_at DESC", [ORG]);
if (!archivedPms.length) console.log("  (none)");
for (const p of archivedPms) {
  const a = await one("SELECT action, detail, at FROM audit_log WHERE org_id = ? AND target = ? AND action LIKE 'pm.%' ORDER BY at DESC LIMIT 1", [ORG, p.id]);
  const reason = a ? `${a.action} — "${a.detail}"` : "no audit row (archived in-app)";
  console.log(`  ${p.id}  "${p.title}"\n      ${reason}`);
}
console.log(`  → restore the REAL ones:  --restore-pms ${archivedPms.slice(0, 2).map((p) => p.id).join(",") || "<ids>"} --apply`);

// ── Report: Copilot conversations (spot the QA runs) ─────────────────────────
console.log("\n── Copilot conversations (newest first) ─────────────────────────");
const convs = await rowsOf("SELECT id, title, asset_id, created_at FROM conversations WHERE org_id = ? ORDER BY created_at DESC LIMIT 40", [ORG]);
if (!convs.length) console.log("  (none)");
for (const c of convs) {
  const cnt = await one("SELECT COUNT(*) AS n FROM messages WHERE org_id = ? AND conversation_id = ?", [ORG, c.id]);
  const first = await one("SELECT content FROM messages WHERE org_id = ? AND conversation_id = ? AND role = 'user' ORDER BY created_at LIMIT 1", [ORG, c.id]);
  const preview = (first?.content ?? c.title ?? "").slice(0, 68).replace(/\s+/g, " ");
  console.log(`  ${c.id}  (${cnt.n} msg)  "${preview}"`);
}
console.log(`  → purge the QA/test ones:  --purge-sessions <id,id,...> --apply`);

if (!restorePms.length && !purgeSessions.length) {
  console.log("\nReport only. Re-run with --restore-pms / --purge-sessions and --apply to act.");
  process.exit(0);
}
if (!APPLY) { console.log("\nDry-run: would act on the ids above. Add --apply to execute."); process.exit(0); }

// ── Apply ────────────────────────────────────────────────────────────────────
const tx = await db.transaction("write");
try {
  for (const id of restorePms) {
    const r = await tx.execute({ sql: "UPDATE pm_programs SET status = 'draft', updated_at = ? WHERE id = ? AND org_id = ? AND status = 'archived'", args: [now, id, ORG] });
    if (r.rowsAffected) {
      await tx.execute({ sql: "INSERT INTO audit_log (id, org_id, actor, action, target, detail, at) VALUES (?,?,?, 'pm.restored', ?, ?, ?)", args: [`aud_${randomUUID()}`, ORG, "demo-prep (owner)", id, "Restored from archive to draft.", now] });
      console.log(`  restored PM ${id} → draft`);
    } else console.log(`  skipped ${id} (not an archived PM in this org)`);
  }
  for (const id of purgeSessions) {
    const m = await tx.execute({ sql: "DELETE FROM messages WHERE org_id = ? AND conversation_id = ?", args: [ORG, id] });
    const c = await tx.execute({ sql: "DELETE FROM conversations WHERE org_id = ? AND id = ?", args: [ORG, id] });
    console.log(`  purged session ${id} (${c.rowsAffected} conversation, ${m.rowsAffected} messages)`);
  }
  await tx.commit();
} catch (e) { await tx.rollback(); console.error("Failed — rolled back:", e.message); process.exit(1); }
console.log("\nDone.");
