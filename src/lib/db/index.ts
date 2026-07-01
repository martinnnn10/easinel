import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema";

// Singleton across hot-reloads in dev.
const globalForDb = globalThis as unknown as {
  __libsql?: Client;
  __drizzle?: LibSQLDatabase<typeof schema>;
  __dbReady?: boolean;
  __dbInit?: Promise<void>;
};

const url = process.env.DATABASE_URL ?? "file:local.db";

// For local file databases (e.g. file:./data/local.db), libSQL will NOT create
// the parent directory and fails to open with SQLITE_CANTOPEN(14) — which also
// breaks `next build` page-data collection. Ensure the directory exists first.
if (url.startsWith("file:")) {
  const filePath = url.slice("file:".length).replace(/^\/\//, "");
  const dir = dirname(filePath);
  if (dir && dir !== "." && dir !== "/") {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* best-effort; surfaced later if the path is truly unwritable */
    }
  }
}

const client =
  globalForDb.__libsql ??
  createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
if (process.env.NODE_ENV !== "production") globalForDb.__libsql = client;

export const db =
  globalForDb.__drizzle ?? drizzle(client, { schema });
if (process.env.NODE_ENV !== "production") globalForDb.__drizzle = db;

export { schema };

// Idempotent table creation — keeps the app zero-setup. For production these
// become Drizzle migrations against PostgreSQL.
const DDL = [
  `CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    name TEXT NOT NULL,
    asset_tag TEXT,
    site TEXT,
    area TEXT,
    line TEXT,
    cell TEXT,
    manufacturer TEXT,
    model TEXT,
    serial_number TEXT,
    asset_type TEXT,
    parent_asset_id TEXT,
    asset_level TEXT,
    status TEXT DEFAULT 'operational',
    criticality TEXT DEFAULT 'medium',
    installed_at INTEGER,
    image_path TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS asset_photos (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    asset_id TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    caption TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS alarm_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    asset_id TEXT NOT NULL,
    code TEXT,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    source TEXT NOT NULL DEFAULT 'manual',
    occurred_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    asset_id TEXT,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'document',
    mime_type TEXT,
    size_bytes INTEGER,
    storage_path TEXT,
    char_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS plc_projects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    document_id TEXT NOT NULL,
    asset_id TEXT,
    filename TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'l5x',
    fidelity TEXT NOT NULL DEFAULT 'none',
    controller_name TEXT,
    processor_type TEXT,
    software_revision TEXT,
    program_count INTEGER DEFAULT 0,
    routine_count INTEGER DEFAULT 0,
    tag_count INTEGER DEFAULT 0,
    aoi_count INTEGER DEFAULT 0,
    udt_count INTEGER DEFAULT 0,
    ir TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    document_id TEXT NOT NULL,
    asset_id TEXT,
    ordinal INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    embedding TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    asset_id TEXT,
    title TEXT NOT NULL DEFAULT 'New conversation',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    actor TEXT NOT NULL DEFAULT 'system',
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    asset_id TEXT,
    number TEXT,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    type TEXT NOT NULL DEFAULT 'corrective',
    assigned_to TEXT,
    est_labor_mins INTEGER,
    parts TEXT,
    safety TEXT,
    source TEXT NOT NULL DEFAULT 'eas',
    external_system TEXT,
    external_id TEXT,
    approval_status TEXT NOT NULL DEFAULT 'approved',
    requested_by TEXT,
    approved_by TEXT,
    approved_at INTEGER,
    rejection_reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS technicians (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    name TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'technician',
    level TEXT DEFAULT 'mid',
    certifications TEXT,
    external_system TEXT,
    external_id TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    name TEXT NOT NULL,
    category TEXT DEFAULT 'general'
  )`,
  `CREATE TABLE IF NOT EXISTS technician_skills (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    technician_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    proficiency INTEGER NOT NULL DEFAULT 0,
    verified INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    connector_key TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    config TEXT,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hashed_key TEXT NOT NULL,
    scopes TEXT DEFAULT 'read,write',
    last_used_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '*',
    secret TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    type TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    password_hash TEXT,
    sso_provider TEXT,
    external_id TEXT,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'technician',
    token TEXT NOT NULL,
    invited_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at INTEGER NOT NULL,
    accepted_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invites_token ON invitations(token)`,
  `CREATE INDEX IF NOT EXISTS idx_invites_org ON invitations(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_asset ON chunks(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_asset ON documents(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plc_doc ON plc_projects(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plc_asset ON plc_projects(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wo_asset ON work_orders(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_apikeys_prefix ON api_keys(prefix)`,
  `CREATE INDEX IF NOT EXISTS idx_techskills_tech ON technician_skills(technician_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assets_org ON assets(org_id)`,
  `CREATE INDEX IF NOT EXISTS idx_asset_photos_asset ON asset_photos(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alarm_events_asset ON alarm_events(asset_id)`,
  // ── Slice 2 ──
  `CREATE TABLE IF NOT EXISTS work_order_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    work_order_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note',
    from_status TEXT,
    to_status TEXT,
    note TEXT,
    actor TEXT NOT NULL DEFAULT 'system',
    at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS oem_failure_signals (
    id TEXT PRIMARY KEY,
    manufacturer TEXT,
    model TEXT,
    asset_type TEXT,
    fault_code TEXT,
    resolution_category TEXT,
    downtime_mins INTEGER,
    labor_mins INTEGER,
    shared_consent INTEGER NOT NULL DEFAULT 0,
    origin_org_id TEXT NOT NULL DEFAULT '__unset__',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wo_events_wo ON work_order_events(work_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_oem_signals_model ON oem_failure_signals(manufacturer, model, fault_code)`,
  `CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    title TEXT NOT NULL,
    asset_id TEXT,
    location TEXT,
    machine_type TEXT,
    symptom TEXT,
    fault_code TEXT,
    operating_condition TEXT,
    safety_condition TEXT,
    known_history TEXT,
    related_document_id TEXT,
    related_drawing_id TEXT,
    related_work_order_id TEXT,
    related_pm_id TEXT,
    related_part_id TEXT,
    expected_diagnostic_path TEXT,
    actual_root_cause TEXT,
    corrective_action TEXT,
    lesson_learned TEXT,
    skill_level TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by TEXT,
    updated_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS pm_programs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    asset_id TEXT,
    title TEXT NOT NULL,
    failure_mode TEXT,
    frequency_label TEXT,
    interval_days INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    est_labor_mins INTEGER,
    tools TEXT,
    parts TEXT,
    safety TEXT,
    reasoning TEXT,
    confidence TEXT,
    source TEXT NOT NULL DEFAULT 'ai_suggested',
    source_work_order_id TEXT,
    created_by TEXT,
    approved_by TEXT,
    approved_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS pm_tasks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    pm_program_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 0,
    instruction TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS pm_schedules (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    pm_program_id TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 30,
    next_due_at INTEGER,
    last_completed_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS pm_completions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    pm_program_id TEXT NOT NULL,
    schedule_id TEXT,
    status TEXT NOT NULL DEFAULT 'done',
    notes TEXT,
    completed_by TEXT,
    completed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS pm_attachments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    pm_program_id TEXT NOT NULL,
    document_id TEXT,
    label TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS pm_source_evidence (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    pm_program_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS parts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_number TEXT,
    manufacturer TEXT,
    manufacturer_part_number TEXT,
    description TEXT NOT NULL,
    category TEXT,
    unit TEXT DEFAULT 'each',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS part_links (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pm_programs_asset ON pm_programs(asset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_tasks_program ON pm_tasks(pm_program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_sched_program ON pm_schedules(pm_program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_links_target ON part_links(target_type, target_id)`,
  `CREATE TABLE IF NOT EXISTS part_aliases (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'alt_pn',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS part_asset_links (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    position TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS part_work_order_links (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    work_order_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'used',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS part_pm_links (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    pm_program_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS part_source_evidence (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS part_suppliers (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL DEFAULT '__unset__',
    part_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    lead_time TEXT,
    price TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_part_aliases_part ON part_aliases(org_id, part_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_aliases_alias ON part_aliases(org_id, alias)`,
  `CREATE INDEX IF NOT EXISTS idx_part_asset_links_part ON part_asset_links(org_id, part_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_wo_links_part ON part_work_order_links(org_id, part_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_pm_links_part ON part_pm_links(org_id, part_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_suppliers_part ON part_suppliers(org_id, part_id)`,
];

// Idempotent additive column migrations for databases created before the rich
// asset schema landed. SQLite has no "ADD COLUMN IF NOT EXISTS", so we read the
// existing columns and add only what's missing. This never drops data and is the
// libSQL stand-in for what will become a numbered Drizzle/Postgres migration.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "assets", column: "site", ddl: "ALTER TABLE assets ADD COLUMN site TEXT" },
  { table: "assets", column: "line", ddl: "ALTER TABLE assets ADD COLUMN line TEXT" },
  { table: "assets", column: "cell", ddl: "ALTER TABLE assets ADD COLUMN cell TEXT" },
  { table: "assets", column: "serial_number", ddl: "ALTER TABLE assets ADD COLUMN serial_number TEXT" },
  { table: "assets", column: "asset_type", ddl: "ALTER TABLE assets ADD COLUMN asset_type TEXT" },
  { table: "assets", column: "parent_asset_id", ddl: "ALTER TABLE assets ADD COLUMN parent_asset_id TEXT" },
  { table: "assets", column: "asset_level", ddl: "ALTER TABLE assets ADD COLUMN asset_level TEXT" },
  { table: "assets", column: "status", ddl: "ALTER TABLE assets ADD COLUMN status TEXT DEFAULT 'operational'" },
  { table: "assets", column: "installed_at", ddl: "ALTER TABLE assets ADD COLUMN installed_at INTEGER" },
  { table: "assets", column: "image_path", ddl: "ALTER TABLE assets ADD COLUMN image_path TEXT" },
  { table: "assets", column: "updated_at", ddl: "ALTER TABLE assets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)" },
  // Slice 2: work order lifecycle fields on databases created before this slice.
  { table: "work_orders", column: "symptom", ddl: "ALTER TABLE work_orders ADD COLUMN symptom TEXT" },
  { table: "work_orders", column: "resolution", ddl: "ALTER TABLE work_orders ADD COLUMN resolution TEXT" },
  { table: "work_orders", column: "reported_at", ddl: "ALTER TABLE work_orders ADD COLUMN reported_at INTEGER" },
  { table: "work_orders", column: "started_at", ddl: "ALTER TABLE work_orders ADD COLUMN started_at INTEGER" },
  { table: "work_orders", column: "closed_at", ddl: "ALTER TABLE work_orders ADD COLUMN closed_at INTEGER" },
  { table: "work_orders", column: "downtime_mins", ddl: "ALTER TABLE work_orders ADD COLUMN downtime_mins INTEGER" },
  // PM loop: structured close-out capture on the work order.
  { table: "work_orders", column: "root_cause", ddl: "ALTER TABLE work_orders ADD COLUMN root_cause TEXT" },
  { table: "work_orders", column: "failed_part", ddl: "ALTER TABLE work_orders ADD COLUMN failed_part TEXT" },
  { table: "work_orders", column: "repair_action", ddl: "ALTER TABLE work_orders ADD COLUMN repair_action TEXT" },
  // Maintenance request → manager/supervisor approval workflow.
  { table: "work_orders", column: "approval_status", ddl: "ALTER TABLE work_orders ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'" },
  { table: "work_orders", column: "requested_by", ddl: "ALTER TABLE work_orders ADD COLUMN requested_by TEXT" },
  { table: "work_orders", column: "approved_by", ddl: "ALTER TABLE work_orders ADD COLUMN approved_by TEXT" },
  { table: "work_orders", column: "approved_at", ddl: "ALTER TABLE work_orders ADD COLUMN approved_at INTEGER" },
  { table: "work_orders", column: "rejection_reason", ddl: "ALTER TABLE work_orders ADD COLUMN rejection_reason TEXT" },
  // Parts Sourcing Copilot: Field Memory + sourcing fields on existing parts.
  { table: "parts", column: "replacement_notes", ddl: "ALTER TABLE parts ADD COLUMN replacement_notes TEXT" },
  { table: "parts", column: "critical_spare", ddl: "ALTER TABLE parts ADD COLUMN critical_spare INTEGER NOT NULL DEFAULT 0" },
  { table: "parts", column: "preferred_supplier", ddl: "ALTER TABLE parts ADD COLUMN preferred_supplier TEXT" },
  { table: "parts", column: "supplier_url", ddl: "ALTER TABLE parts ADD COLUMN supplier_url TEXT" },
  { table: "parts", column: "manufacturer_url", ddl: "ALTER TABLE parts ADD COLUMN manufacturer_url TEXT" },
  { table: "parts", column: "est_lead_time", ddl: "ALTER TABLE parts ADD COLUMN est_lead_time TEXT" },
  { table: "parts", column: "est_price", ddl: "ALTER TABLE parts ADD COLUMN est_price TEXT" },
  { table: "parts", column: "stock_qty", ddl: "ALTER TABLE parts ADD COLUMN stock_qty INTEGER" },
  { table: "parts", column: "reorder_point", ddl: "ALTER TABLE parts ADD COLUMN reorder_point INTEGER" },
  { table: "parts", column: "alternate_part_numbers", ddl: "ALTER TABLE parts ADD COLUMN alternate_part_numbers TEXT" },
  { table: "parts", column: "status", ddl: "ALTER TABLE parts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'" },
  // PM procedure quality standard: rich structured per-task detail (JSON).
  { table: "pm_tasks", column: "detail", ddl: "ALTER TABLE pm_tasks ADD COLUMN detail TEXT" },
];

async function runColumnMigrations(): Promise<void> {
  // Group needed columns by table, query existing columns once per table.
  const tables = Array.from(new Set(COLUMN_MIGRATIONS.map((m) => m.table)));
  for (const table of tables) {
    let existing: Set<string>;
    try {
      const info = await client.execute(`PRAGMA table_info(${table})`);
      existing = new Set(info.rows.map((r) => String((r as Record<string, unknown>).name)));
    } catch {
      continue; // table doesn't exist yet; CREATE TABLE handled the full schema
    }
    for (const m of COLUMN_MIGRATIONS.filter((x) => x.table === table)) {
      if (!existing.has(m.column)) {
        try {
          await client.execute(m.ddl);
        } catch (err) {
          console.error(`[migrate] ${m.table}.${m.column} skipped:`, (err as Error).message);
        }
      }
    }
  }
}

// Serialize initialization: concurrent first-requests all await the SAME init
// promise rather than racing the DDL + seed (which previously caused duplicate
// insert attempts on cold start).
export async function ensureDb(): Promise<void> {
  if (globalForDb.__dbReady) return;
  if (!globalForDb.__dbInit) globalForDb.__dbInit = initDb();
  await globalForDb.__dbInit;
}

async function initDb(): Promise<void> {
  for (const stmt of DDL) {
    await client.execute(stmt);
  }
  // Additive column migrations for pre-existing databases (no data loss).
  await runColumnMigrations();

  // ── Reserved tenant scopes ────────────────────────────────────────────
  // The platform models THREE kinds of org scope, all isolated:
  //   1. org_demo   — the curated Demo Organization (sales demos / open mode)
  //   2. __global__ — shared OEM knowledge library (read-only platform asset)
  //   3. org_*      — real customer tenants, always created EMPTY
  // There is intentionally NO shared 'default' org anymore.
  const { DEMO_ORG, DEMO_ORG_NAME, PROD_ORG, PROD_ORG_NAME, GLOBAL_ORG } = await import("@/lib/util");
  await client.execute({
    sql: `INSERT OR IGNORE INTO orgs (id, name) VALUES (?, ?)`,
    args: [DEMO_ORG, DEMO_ORG_NAME],
  });
  // The real Production Workspace tenant (used by open mode when
  // OPEN_MODE_ORG=production). Starts empty; accumulates the customer's own data.
  await client.execute({
    sql: `INSERT OR IGNORE INTO orgs (id, name) VALUES (?, ?)`,
    args: [PROD_ORG, PROD_ORG_NAME],
  });
  // The global scope is a reserved system org so FK-style joins resolve; it is
  // never selectable as a customer workspace and holds only OEM references.
  await client.execute({
    sql: `INSERT OR IGNORE INTO orgs (id, name) VALUES (?, ?)`,
    args: [GLOBAL_ORG, "Global Knowledge Library (system)"],
  });
  globalForDb.__dbReady = true;

  // Preload the curated demo dataset (Conveyor 3 + PowerFlex docs + history)
  // into the ISOLATED Demo Organization tenant. This is gated so a production
  // deployment serving only real customers can disable it with
  // SEED_DEMO_ORG=false; it defaults on so sales demos work out of the box.
  // Imported lazily to avoid a circular import (seed.ts imports from here).
  const isEphemeral =
    process.env.NODE_ENV === "test" ||
    url === ":memory:" ||
    url.includes(":memory:");
  if (process.env.SEED_DEMO_ORG !== "false" && !isEphemeral) {
    try {
      const { seedDemo } = await import("@/lib/seed");
      await seedDemo();
    } catch (err) {
      // Never let seeding block the app; log and continue.
      console.error("[seedDemo] skipped:", (err as Error).message);
    }
  }

  // Pre-seeded OEM knowledge: GLOBAL references (org=__global__) so every tenant
  // — including brand-new empty customer orgs — gets grounded answers on day one
  // before any upload. This is shared platform knowledge, not tenant data.
  try {
    const { seedOemKnowledge } = await import("@/lib/knowledge/oem");
    await seedOemKnowledge();
  } catch (err) {
    console.error("[seedOemKnowledge] skipped:", (err as Error).message);
  }
}
