/**
 * populate-demo-workspace.mjs — make a workspace look LIVED IN for a demo.
 *
 * ⚙️ INTERNAL ADMIN / SALES UTILITY — NOT part of the product experience.
 *    Operational pages (Today, Reliability, ROI, Reuse Impact, PM, Work Orders,
 *    Copilot) show REAL org data only; the product never seeds itself. Run this
 *    by hand ONLY against an explicitly labeled demo/training org for a private
 *    sales walkthrough, and undo it (--undo --apply) when the demo is over.
 *    For teaching the loop without any data, use the in-app "How It Works" page.
 *
 * ⚠️ NEVER run this against a real customer org.
 *
 * The engine is a 9.5; the demo experience dies on an empty workspace. Manual
 * data entry can't reproduce the *interlinked* records the intelligence
 * surfaces need — recurring faults that roll up into repeat-risk, a later
 * repair that beat the machine's own median (avoided downtime), lessons and
 * documents the Copilot cited, PMs born from failures. This script builds that
 * whole graph from ONE editable data block, so the Reliability Command Center,
 * Reuse Impact page, and Copilot all light up with a coherent story.
 *
 * ─ IMPORTANT ────────────────────────────────────────────────────────────────
 *   The example plant below is a REALISTIC PLACEHOLDER. For a real prospect
 *   demo, replace the ASSETS block with the machines on THAT client's floor and
 *   their real recurring faults. Fake-looking data is exactly what kills a
 *   demo — this tool's job is to wire up whatever real nouns you give it.
 *
 * ─ Safety ───────────────────────────────────────────────────────────────────
 *   • Requires an explicit --org <id>; there is no default. It prints the org's
 *     name and aborts if the org doesn't exist, so you can't seed the wrong DB.
 *   • Every record id is prefixed `demoseed_` and scoped to the org. --undo
 *     removes exactly those rows and nothing else. --apply is idempotent
 *     (it clears prior demoseed rows in the org first, then re-inserts).
 *   • DRY-RUN by default. Nothing is written without --apply.
 *   • Only ever touches the org you name. No other org's data is read or written.
 *
 * ─ Usage (from the app root; DATABASE_URL honored exactly like the app) ───────
 *   node scripts/populate-demo-workspace.mjs --org <ORG_ID>            # dry-run
 *   node scripts/populate-demo-workspace.mjs --org <ORG_ID> --apply    # write
 *   node scripts/populate-demo-workspace.mjs --org <ORG_ID> --apply --rate 2500
 *   node scripts/populate-demo-workspace.mjs --org <ORG_ID> --undo --apply
 *
 *   Find your org id:  SELECT id, name FROM orgs;   (db:studio, or sqlite CLI)
 */
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// EDIT ME — the plant's real floor. Each asset tells one story: a recurring
// fault, a few real repairs (oldest→newest downtime in minutes; the LAST repair
// is the one that beat the machine's median, i.e. knowledge paid off), whether a
// PM is now in place, an optional uploaded manual, and questions techs asked.
// ─────────────────────────────────────────────────────────────────────────────
const RATE_PER_HOUR = 2200; // $/hour of downtime (override with --rate). Set 0 to hide dollars.

const ASSETS = [
  {
    key: "filler3",
    name: "Line 3 Filler",
    manufacturer: "Krones",
    model: "Modulfill VFS",
    fault: { part: "servo drive", symptom: "Filler servo faults mid-cycle and stops the line",
      rootCause: "servo drive overtemp from clogged cabinet filter", repair: "replaced cabinet fan filter, reset drive, verified temps" },
    downtimes: [180, 240, 200, 90], // 4 repairs; last (90) beat the 200 median → savings
    pm: "active",
    manual: { filename: "Krones Modulfill VFS — service manual.pdf", kind: "manual" },
    lessonLabel: "servo drive overtemp — clean cabinet filter first",
    gapQuestions: [],
  },
  {
    key: "capper2",
    name: "Capper #2",
    manufacturer: "Zalkin",
    model: "SM-6",
    fault: { part: "torque clutch", symptom: "Capper loses application torque after a changeover",
      rootCause: "worn torque clutch springs", repair: "replaced clutch spring pack, re-taught torque" },
    downtimes: [60, 75, 55], // recurring, NO later win yet → repeat-risk with no PM to act on
    pm: "none",
    manual: null, // no uploaded doc → becomes a "Sharpen the Copilot" blind spot
    gapQuestions: ["why does Capper #2 keep losing torque after a changeover", "capper #2 cap misalignment root cause"],
  },
  {
    key: "casepacker",
    name: "Case Packer",
    manufacturer: "Douglas Machine",
    model: "Axiom",
    fault: { part: "photoeye", symptom: "Case packer photoeye faults and jams the infeed",
      rootCause: "product dust on retroreflective photoeye", repair: "cleaned photoeye lens, added weekly wipe-down" },
    downtimes: [95, 110, 80, 40], // last (40) beat the 95 median → more savings
    pm: "active",
    manual: { filename: "Douglas Axiom — electrical drawings.pdf", kind: "drawing" },
    lessonLabel: "photoeye jams — clean lens before replacing",
    gapQuestions: [],
  },
  {
    key: "palletizer",
    name: "Palletizer",
    manufacturer: "Columbia",
    model: "FL-6800",
    fault: { part: "hoist chain", symptom: "Palletizer hoist chain slack alarm trips",
      rootCause: "chain stretch past adjustment", repair: "adjusted take-up, logged chain for replacement" },
    downtimes: [130, 150], // only 2 repairs → shows on activity but not enough for a savings claim
    pm: "draft",
    manual: { filename: "Columbia FL-6800 — operator manual.pdf", kind: "manual" },
    lessonLabel: "hoist chain slack — check take-up before condemning the drive",
    gapQuestions: [],
  },
];

// A couple of realistic Copilot sessions so "Recent troubleshooting sessions"
// reads like real shift work, not automated test runs. { assetKey, title, ask, answer }
const CONVERSATIONS = [
  { assetKey: "filler3", title: "Line 3 Filler servo faulting mid-cycle",
    ask: "Line 3 filler servo faults about 20 minutes into a run and drops the line. Where do I start?",
    answer: "Start at the drive cabinet, not the servo. This machine's history shows three prior servo faults, all traced to cabinet overtemp from a clogged filter. Check cabinet temp and the fan filter first; reset the drive and confirm temps settle before condemning the servo." },
  { assetKey: "casepacker", title: "Case packer infeed jam on photoeye",
    ask: "Case packer keeps jamming at the infeed and throwing a photoeye fault. Bad sensor?",
    answer: "Likely not the sensor. Prior repairs on this machine were all product dust on the retroreflective photoeye — clean the lens and reflector first. A weekly wipe-down was added as the standing fix; verify it's being done before you swap hardware." },
];
// ─────────────────────────────────────────────────────────────────────────────
// END EDIT ME — implementation below.
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const UNDO = args.includes("--undo");
const orgIdx = args.indexOf("--org");
const ORG = orgIdx >= 0 ? args[orgIdx + 1] : null;
const rateIdx = args.indexOf("--rate");
const RATE = rateIdx >= 0 ? Number(args[rateIdx + 1]) : RATE_PER_HOUR;
const url = process.env.DATABASE_URL ?? "file:local.db";

if (!ORG) {
  console.error("Refusing to run: pass --org <ORG_ID> explicitly. Find it with:  SELECT id, name FROM orgs;");
  process.exit(1);
}

const db = createClient({ url });
const one = async (sql, a) => (await db.execute({ sql, args: a })).rows[0];
const DAY = 86400_000;
const now = Date.now();
const TAG = "demoseed_"; // every id we create starts with this — makes undo exact

console.log(`\nDatabase: ${url}\nOrg:      ${ORG}\nMode:     ${UNDO ? "UNDO" : "POPULATE"} · ${APPLY ? "APPLY (writes)" : "DRY-RUN (no writes; add --apply)"}\n`);

const org = await one("SELECT name FROM orgs WHERE id = ?", [ORG]);
if (!org) {
  console.error(`Org ${ORG} not found in this database — aborting (wrong DB or wrong id).`);
  process.exit(1);
}
console.log(`Target org: "${org.name}"`);

// Tables this tool owns demoseed rows in — the ONLY tables --undo clears.
const TABLES = ["reuse_events", "knowledge_gaps", "messages", "conversations", "pm_schedules", "pm_programs", "work_orders", "documents", "assets"];

async function clearDemoSeed(exec) {
  for (const t of TABLES) {
    await exec({ sql: `DELETE FROM ${t} WHERE org_id = ? AND id LIKE '${TAG}%'`, args: [ORG] });
  }
}

if (UNDO) {
  if (!APPLY) {
    for (const t of TABLES) {
      const r = await one(`SELECT COUNT(*) AS n FROM ${t} WHERE org_id = ? AND id LIKE '${TAG}%'`, [ORG]);
      console.log(`  ${t}: ${r.n} demoseed row(s) would be removed`);
    }
    console.log("\nDry-run. Re-run with --undo --apply to remove them.");
    process.exit(0);
  }
  const tx = await db.transaction("write");
  try { await clearDemoSeed((q) => tx.execute(q)); await tx.commit(); }
  catch (e) { await tx.rollback(); console.error("Undo failed — rolled back:", e.message); process.exit(1); }
  console.log("\nRemoved all demoseed rows. (Org downtime rate left as-is.)");
  process.exit(0);
}

// ── Build the record set in memory (so dry-run can summarize it) ──────────────
const author = await one("SELECT id, name FROM users WHERE org_id = ? ORDER BY created_at LIMIT 1", [ORG]);
const authorId = author?.id ?? null;

const rows = { assets: [], work_orders: [], documents: [], pm_programs: [], pm_schedules: [], reuse_events: [], knowledge_gaps: [], conversations: [], messages: [] };
const gid = (kind, k, n) => `${TAG}${kind}_${k}${n != null ? `_${n}` : ""}`;
const median = (ns) => { const s = [...ns].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

let totalAvoidedMins = 0;

for (const a of ASSETS) {
  const assetId = gid("ast", a.key);
  rows.assets.push({ id: assetId, name: a.name, manufacturer: a.manufacturer, model: a.model });

  // Manual/drawing document (if any) — grounds the Copilot; its absence is a gap.
  let docId = null;
  if (a.manual) {
    docId = gid("doc", a.key);
    rows.documents.push({ id: docId, assetId, filename: a.manual.filename, kind: a.manual.kind });
  }

  // Work orders: oldest→newest, spaced ~2 weeks apart, most recent 5 days ago.
  const woIds = [];
  a.downtimes.forEach((dt, i) => {
    const fromEnd = a.downtimes.length - 1 - i;
    const closedAt = now - (5 + fromEnd * 14) * DAY;
    const woId = gid("wo", a.key, i);
    woIds.push(woId);
    rows.work_orders.push({
      id: woId, assetId, title: `${a.name} — ${a.fault.symptom}`, symptom: a.fault.symptom,
      failedPart: a.fault.part, rootCause: a.fault.rootCause, repair: a.fault.repair,
      downtime: dt, reportedAt: closedAt - dt * 60_000, closedAt,
    });
  });

  const priors = a.downtimes.slice(0, -1);
  const lastDt = a.downtimes[a.downtimes.length - 1];
  const assistedWoId = woIds[woIds.length - 1];
  const priorWoId = woIds[0];
  const enoughToCompare = priors.length >= 2;
  const beat = enoughToCompare && lastDt < median(priors);
  if (beat) totalAvoidedMins += median(priors) - lastDt;

  // Reuse events — the machine-memory graph the intelligence surfaces read.
  const push = (eventType, extra) => rows.reuse_events.push({ id: gid("re", `${a.key}_${eventType}_${rows.reuse_events.length}`), eventType, assetId, ...extra });
  // Prior fix surfaced at intake on the most recent job (×2) + used in closeout (×1).
  push("prior_fix_surfaced", { workOrderId: assistedWoId, sourceType: "work_order", sourceId: priorWoId, label: a.fault.part, authorId });
  push("prior_fix_surfaced", { workOrderId: assistedWoId, sourceType: "work_order", sourceId: priorWoId, label: a.fault.part, authorId });
  push("prior_fix_used_in_closeout", { workOrderId: assistedWoId, sourceType: "work_order", sourceId: priorWoId, label: a.fault.part, authorId });
  // A captured lesson the Copilot cited (credited to a teammate).
  if (a.lessonLabel) {
    push("lesson_surfaced", { workOrderId: assistedWoId, sourceType: "work_order", sourceId: priorWoId, label: a.lessonLabel, authorId });
    push("lesson_surfaced", { workOrderId: assistedWoId, sourceType: "work_order", sourceId: priorWoId, label: a.lessonLabel, authorId });
  }
  // The uploaded document, cited by the Copilot.
  if (docId) push("document_cited", { workOrderId: assistedWoId, sourceType: "document", sourceId: docId, label: a.manual.filename });
  // A PM born from the recurring failure (when one now exists).
  if (a.pm !== "none") push("pm_created_from_failure", { workOrderId: assistedWoId, sourceType: "work_order", sourceId: priorWoId, label: a.fault.part });

  // PM program + schedule (active = "in place", draft = proposed).
  if (a.pm === "active" || a.pm === "draft") {
    const pmId = gid("pm", a.key);
    rows.pm_programs.push({ id: pmId, assetId, title: `${a.fault.part} PM — ${a.name}`, failureMode: a.fault.rootCause, status: a.pm, sourceWorkOrderId: assistedWoId });
    if (a.pm === "active") rows.pm_schedules.push({ id: gid("sch", a.key), pmProgramId: pmId, intervalDays: 30 });
  }

  // Knowledge gaps — machines asked about with no own docs.
  (a.gapQuestions ?? []).forEach((q, i) => rows.knowledge_gaps.push({ id: gid("gap", a.key, i), assetId, question: q }));
}

// Realistic Copilot sessions.
for (const c of CONVERSATIONS) {
  const assetId = gid("ast", c.assetKey);
  const convId = gid("conv", c.assetKey);
  rows.conversations.push({ id: convId, assetId, title: c.title });
  rows.messages.push({ id: gid("msg", `${c.assetKey}_u`), conversationId: convId, role: "user", content: c.ask });
  rows.messages.push({ id: gid("msg", `${c.assetKey}_a`), conversationId: convId, role: "assistant", content: c.answer });
}

// ── Summary (always printed) ─────────────────────────────────────────────────
const avoidedH = Math.round((totalAvoidedMins / 60) * 10) / 10;
console.log("\nWill create (all ids prefixed 'demoseed_', scoped to this org):");
console.log(`  assets:        ${rows.assets.length}`);
console.log(`  work orders:   ${rows.work_orders.length} (closed corrective, with real downtime & root cause)`);
console.log(`  documents:     ${rows.documents.length}`);
console.log(`  PM programs:   ${rows.pm_programs.length} (${rows.pm_programs.filter((p) => p.status === "active").length} active, ${rows.pm_programs.filter((p) => p.status === "draft").length} draft)`);
console.log(`  reuse events:  ${rows.reuse_events.length}`);
console.log(`  knowledge gaps:${rows.knowledge_gaps.length}`);
console.log(`  conversations: ${rows.conversations.length}`);
console.log(`  downtime rate: ${RATE > 0 ? `$${RATE}/h (org setting)` : "unchanged"}`);
console.log(`  → Reliability hero should show ~${avoidedH} h avoided${RATE > 0 ? ` ≈ $${Math.round(avoidedH * RATE).toLocaleString()}` : ""}.`);

if (!APPLY) {
  console.log("\nDry-run complete. Re-run with --apply to write. To remove later: --undo --apply.");
  process.exit(0);
}

// ── Apply — one transaction. Clear prior demoseed rows first (idempotent). ────
const tx = await db.transaction("write");
try {
  await clearDemoSeed((q) => tx.execute(q));
  if (RATE > 0) await tx.execute({ sql: "UPDATE orgs SET downtime_cost_per_hour = ? WHERE id = ?", args: [RATE, ORG] });

  for (const a of rows.assets)
    await tx.execute({ sql: "INSERT INTO assets (id, org_id, name, manufacturer, model, status, created_at, updated_at) VALUES (?,?,?,?,?, 'operational', ?, ?)", args: [a.id, ORG, a.name, a.manufacturer, a.model, now, now] });

  for (const d of rows.documents)
    await tx.execute({ sql: "INSERT INTO documents (id, org_id, asset_id, filename, kind, char_count, processing_status, created_at) VALUES (?,?,?,?,?, 4000, 'ready', ?)", args: [d.id, ORG, d.assetId, d.filename, d.kind, now] });

  for (const w of rows.work_orders)
    await tx.execute({
      sql: `INSERT INTO work_orders (id, org_id, asset_id, title, symptom, failed_part, root_cause, repair_action, resolution, status, type, priority, source, approval_status, downtime_mins, reported_at, closed_at, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?, 'done', 'corrective', 'high', 'eas', 'approved', ?, ?, ?, ?, ?)`,
      args: [w.id, ORG, w.assetId, w.title, w.symptom, w.failedPart, w.rootCause, w.repair, w.repair, w.downtime, w.reportedAt, w.closedAt, w.reportedAt, w.closedAt],
    });

  for (const p of rows.pm_programs)
    await tx.execute({ sql: "INSERT INTO pm_programs (id, org_id, asset_id, title, failure_mode, frequency_label, interval_days, status, source, source_work_order_id, created_at, updated_at) VALUES (?,?,?,?,?, '30-day', 30, ?, 'ai_suggested', ?, ?, ?)", args: [p.id, ORG, p.assetId, p.title, p.failureMode, p.status, p.sourceWorkOrderId, now, now] });
  for (const s of rows.pm_schedules)
    await tx.execute({ sql: "INSERT INTO pm_schedules (id, org_id, pm_program_id, interval_days, next_due_at, active, created_at) VALUES (?,?,?, 30, ?, 1, ?)", args: [s.id, ORG, s.pmProgramId, now + 30 * DAY, now] });

  for (const e of rows.reuse_events)
    await tx.execute({ sql: "INSERT INTO reuse_events (id, org_id, event_type, asset_id, work_order_id, source_type, source_id, original_author_user_id, label, at) VALUES (?,?,?,?,?,?,?,?,?,?)", args: [e.id, ORG, e.eventType, e.assetId, e.workOrderId ?? null, e.sourceType ?? null, e.sourceId ?? null, e.authorId ?? null, e.label ?? null, now] });

  for (const g of rows.knowledge_gaps)
    await tx.execute({ sql: "INSERT INTO knowledge_gaps (id, org_id, asset_id, question, at) VALUES (?,?,?,?,?)", args: [g.id, ORG, g.assetId, g.question, now] });

  for (const c of rows.conversations)
    await tx.execute({ sql: "INSERT INTO conversations (id, org_id, asset_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)", args: [c.id, ORG, c.assetId, c.title, now, now] });
  for (const m of rows.messages)
    await tx.execute({ sql: "INSERT INTO messages (id, org_id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?,?)", args: [m.id, ORG, m.conversationId, m.role, m.content, now] });

  await tx.commit();
} catch (e) {
  await tx.rollback();
  console.error("\nTransaction failed — rolled back, nothing changed:", e.message);
  process.exit(1);
}

console.log("\n✅ Applied. Open /reliability, /impact, /copilot, and /work-orders — the workspace now reads as lived-in.");
console.log("   To reset:  node scripts/populate-demo-workspace.mjs --org " + ORG + " --undo --apply");
