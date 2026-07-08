import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// Fully multi-tenant: EVERY row carries an orgId and every repository query is
// scoped by it (see src/lib/tenancy.isolation.test.ts for the enforced
// contract). There is intentionally NO shared "default" org. The column default
// is a non-routable sentinel ("__unset__") so that an accidental insert without
// an explicit orgId lands in an isolated, non-customer bucket rather than
// silently pooling into a real tenant. Reserved system scopes: DEMO_ORG
// (curated sales-demo tenant) and GLOBAL_ORG (read-only OEM knowledge library).

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Fully-loaded cost of one hour of unplanned downtime for this plant/line
  // (lost production + labor + scrap). One honest org-level input that turns
  // recorded downtime hours into dollars. Null until the owner sets it — the UI
  // never invents a rate.
  downtimeCostPerHour: real("downtime_cost_per_hour"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  name: text("name").notNull(),
  assetTag: text("asset_tag"),
  // Location hierarchy: site → area → production line → cell/position
  site: text("site"),
  area: text("area"),
  line: text("line"),
  cell: text("cell"),
  // Nameplate / identity
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: text("serial_number"),
  assetType: text("asset_type"), // conveyor|drive|robot|pump|press|packaging|hvac|other
  // Parent-child hierarchy: Site → Area → Line → Machine → Component → Part
  parentAssetId: text("parent_asset_id"),
  assetLevel: text("asset_level"), // site|area|line|machine|component|part
  // Lifecycle
  status: text("status").default("operational"), // operational|degraded|down|maintenance|retired
  criticality: text("criticality").default("medium"), // low|medium|high|critical
  installedAt: integer("installed_at", { mode: "timestamp_ms" }),
  // Primary photo storage ref (full gallery lives in assetPhotos)
  imagePath: text("image_path"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Asset photo gallery — multiple images per asset (nameplate, install, fault).
export const assetPhotos = sqliteTable("asset_photos", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id").notNull(),
  storagePath: text("storage_path").notNull(),
  caption: text("caption"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Uploaded documents (manuals, drawings, PLC backups, alarm logs, photos…)
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id"), // optional: doc scoped to an asset
  filename: text("filename").notNull(),
  kind: text("kind").notNull().default("document"), // manual|drawing|plc|photo|alarm|vibration|sop|document
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  // text content extracted at ingest time (for retrieval). Binary stored on disk.
  storagePath: text("storage_path"),
  charCount: integer("char_count").default(0),
  processingStatus: text("processing_status").default("ready"), // pending|processing|ready|failed
  // When set, the document is hidden from the Knowledge base list and excluded
  // from retrieval (never cited by Copilot). The row and its chunks are kept —
  // archiving is reversible (clear archived_at to restore). Not a delete.
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Parsed PLC projects (one row per uploaded .L5X / .ACD). The full vendor-
// neutral intermediate representation is stored as JSON in `ir` so the
// Knowledge Explorer and the AI can read structured programs/routines/tags/
// AOIs/UDTs without re-parsing the source on every request.
export const plcProjects = sqliteTable("plc_projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  documentId: text("document_id").notNull(),
  assetId: text("asset_id"),
  filename: text("filename").notNull(),
  source: text("source").notNull().default("l5x"), // l5x|acd|unknown
  fidelity: text("fidelity").notNull().default("none"), // full|partial|summary|none
  controllerName: text("controller_name"),
  processorType: text("processor_type"),
  softwareRevision: text("software_revision"),
  // roll-up counts for list display
  programCount: integer("program_count").default(0),
  routineCount: integer("routine_count").default(0),
  tagCount: integer("tag_count").default(0),
  aoiCount: integer("aoi_count").default(0),
  udtCount: integer("udt_count").default(0),
  // the full PlcProjectIR as JSON
  ir: text("ir").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Chunked + indexed document text for retrieval (RAG).
export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  documentId: text("document_id").notNull(),
  assetId: text("asset_id"),
  ordinal: integer("ordinal").notNull().default(0),
  content: text("content").notNull(),
  // optional vector embedding (JSON-encoded float array) for future vector search
  embedding: text("embedding"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// A conversation. Can be global (assetId null) or scoped to a machine.
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id"),
  title: text("title").notNull().default("New conversation"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(), // user|assistant|system
  content: text("content").notNull(),
  // JSON metadata: attachments, retrieved sources, confidence, etc.
  meta: text("meta"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Append-only audit log (enterprise requirement).
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  actor: text("actor").notNull().default("system"),
  action: text("action").notNull(),
  target: text("target"),
  detail: text("detail"),
  at: integer("at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Append-only knowledge-reuse log. Records when captured maintenance knowledge
// (a prior fix, scenario, lesson, document, or PM) was SURFACED to a technician
// and, later, USED — so a manager can see whether shared knowledge actually
// helped, not just how much was posted. Impact (avoided downtime) is computed at
// read time from real work orders, never stored/invented here.
export const reuseEvents = sqliteTable("reuse_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  // prior_fix_surfaced | prior_fix_used_in_closeout | scenario_surfaced |
  // lesson_surfaced | document_cited | pm_suggested_from_failure |
  // pm_created_from_failure | pm_approved_from_failure
  eventType: text("event_type").notNull(),
  assetId: text("asset_id"),
  workOrderId: text("work_order_id"),
  sourceType: text("source_type"), // prior_work_order | scenario | lesson | document | pm
  sourceId: text("source_id"),
  surfacedToUserId: text("surfaced_to_user_id"), // who saw/used it (id or email)
  originalAuthorUserId: text("original_author_user_id"), // who captured it (id or email)
  label: text("label"), // fault label for grouping (e.g. "F007")
  at: integer("at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Copilot knowledge gaps — recorded when an asset-scoped question could NOT be
// grounded in any of the org's OWN documents (the OEM reference library and
// general knowledge don't count). Drives the honest "upload these manuals to
// sharpen the Copilot" surface. Only ever the org's own real questions; nothing
// invented.
export const knowledgeGaps = sqliteTable("knowledge_gaps", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id"),
  question: text("question").notNull(),
  at: integer("at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ───────────────────────── Platform layer ─────────────────────────

// Work orders — first-class records that can originate in EAS or sync to/from
// a CMMS (MaintainX, Fiix, SAP PM, Maximo…).
export const workOrders = sqliteTable("work_orders", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id"),
  number: text("number"),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"), // low|medium|high|urgent
  status: text("status").notNull().default("open"), // open|in_progress|on_hold|done|synced
  type: text("type").notNull().default("corrective"), // corrective|preventive|inspection
  assignedTo: text("assigned_to"),
  estLaborMins: integer("est_labor_mins"),
  parts: text("parts"), // JSON array
  safety: text("safety"), // JSON array of safety notes
  source: text("source").notNull().default("eas"), // eas|copilot|<connectorKey>
  externalSystem: text("external_system"),
  externalId: text("external_id"),
  // ── Slice 2: Daily Habit lifecycle fields ──
  // The technician's report of the symptom at the moment the machine went down.
  symptom: text("symptom"),
  // The resolution / what fixed it (free text), captured on close.
  resolution: text("resolution"),
  // Lifecycle timestamps for true MTTR (down → restored), not just est. labor.
  reportedAt: integer("reported_at", { mode: "timestamp_ms" }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  // Actual downtime minutes (machine down → restored), computed on close.
  downtimeMins: integer("downtime_mins"),
  // Structured close-out capture — the inputs to the PM intelligence loop.
  rootCause: text("root_cause"),
  failedPart: text("failed_part"),
  repairAction: text("repair_action"),
  // ── Maintenance request → approval workflow ──
  // A normal work order is born 'approved'. A REQUEST submitted by a technician
  // (or via the request entry point) is born 'pending' and stays out of the
  // active work queues until a maintenance manager/supervisor approves it.
  approvalStatus: text("approval_status").notNull().default("approved"), // approved|pending|rejected
  requestedBy: text("requested_by"),
  approvedBy: text("approved_by"),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  rejectionReason: text("rejection_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ── Slice 2: Work order lifecycle event history ──
// Append-only log of every state transition + note on a work order. This is the
// audit trail of HOW a machine-down was worked, and the raw material the
// Maintenance Memory layer (Slice 4) will distill into lessons.
export const workOrderEvents = sqliteTable("work_order_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  workOrderId: text("work_order_id").notNull(),
  kind: text("kind").notNull().default("note"), // status|note|assignment|created
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  note: text("note"),
  actor: text("actor").notNull().default("system"),
  at: integer("at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ── Slice 2: Moat-aware OEM failure→fix signal ──
// Decision 3 (cross-customer learning). Every closed corrective work order can
// emit ONE anonymized signal keyed ONLY by OEM make/model + fault code — never
// by customer, plant, asset id, or any free text that could identify a tenant.
// This table is the deliberate boundary between tenant-private process data and
// poolable OEM-level intelligence. Pooling stays OFF until contractually enabled
// (sharedConsent), but the schema separation is baked in now so it never needs a
// retrofit. `originOrgId` is retained ONLY so a tenant can delete its own
// contributions (right to be forgotten); it is never exposed in pooled queries.
export const oemFailureSignals = sqliteTable("oem_failure_signals", {
  id: text("id").primaryKey(),
  // Anonymizable dimensions (safe to pool):
  manufacturer: text("manufacturer"),
  model: text("model"),
  assetType: text("asset_type"),
  faultCode: text("fault_code"),
  // Outcome dimensions (safe to pool — no tenant identifiers):
  resolutionCategory: text("resolution_category"), // mechanical|electrical|cooling|controls|other
  downtimeMins: integer("downtime_mins"),
  laborMins: integer("labor_mins"),
  // Governance:
  sharedConsent: integer("shared_consent", { mode: "boolean" }).notNull().default(false),
  originOrgId: text("origin_org_id").notNull().default("__unset__"), // for deletion only, never pooled
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Workforce intelligence — the bridge to ATS/HR. Technicians + a skills matrix.
export const technicians = sqliteTable("technicians", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").default("technician"), // technician|controls|planner|reliability|supervisor
  level: text("level").default("mid"), // apprentice|junior|mid|senior|lead
  certifications: text("certifications"), // JSON array
  externalSystem: text("external_system"), // ATS/HRIS this person syncs with
  externalId: text("external_id"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  name: text("name").notNull(),
  category: text("category").default("general"), // electrical|mechanical|controls|safety|…
});

export const technicianSkills = sqliteTable("technician_skills", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  technicianId: text("technician_id").notNull(),
  skillId: text("skill_id").notNull(),
  proficiency: integer("proficiency").notNull().default(0), // 0–5
  verified: integer("verified", { mode: "boolean" }).default(false),
});

// Connector configurations (one row per connected external system).
export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  connectorKey: text("connector_key").notNull(), // maintainx|fiix|sap_pm|tractian…
  name: text("name").notNull(),
  category: text("category").notNull(), // cmms|erp|sensors
  status: text("status").notNull().default("disconnected"), // connected|disconnected|error
  // Non-secret config only (base URLs, modes). Secrets belong in env / a vault.
  config: text("config"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// API keys for the public platform API (hashed; prefix shown in UI).
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hashedKey: text("hashed_key").notNull(),
  scopes: text("scopes").default("read,write"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Outbound webhooks (subscribe external systems to EAS events).
export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  url: text("url").notNull(),
  events: text("events").notNull().default("*"), // csv of event types or *
  secret: text("secret").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Event outbox / log (also feeds webhook delivery + future analytics).
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  type: text("type").notNull(),
  payload: text("payload"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ───────────────────────── Auth / RBAC ─────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("viewer"), // owner|admin|manager|technician|viewer
  passwordHash: text("password_hash"), // null for SSO-only users
  ssoProvider: text("sso_provider"),
  externalId: text("external_id"),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  // Pilot-readiness: email verification + password reset
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  verificationToken: text("verification_token"),
  resetToken: text("reset_token"),
  resetTokenExpires: integer("reset_token_expires", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // opaque session token
  orgId: text("org_id").notNull().default("__unset__"),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Pending invitations to join an organization. Token-based, role-scoped, and
// strictly tenant-bound: accepting an invite can ONLY create a user inside the
// org that issued it. This replaces the awkward "set a teammate's temp password"
// pattern with the SSO-friendly flow Fortune 500 buyers expect.
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  email: text("email").notNull(),
  role: text("role").notNull().default("technician"),
  token: text("token").notNull(), // opaque, single-use
  invitedBy: text("invited_by"), // user id of the inviter
  status: text("status").notNull().default("pending"), // pending|accepted|revoked
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Alarm / fault history feeding the asset digital twin. Rows can originate from
// uploaded alarm logs, a historian/SCADA sync, or be derived from a closed work
// order. Kept generic so any source maps cleanly.
export const alarmEvents = sqliteTable("alarm_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id").notNull(),
  code: text("code"), // e.g. F081
  message: text("message").notNull(),
  severity: text("severity").notNull().default("warning"), // info|warning|fault|critical
  source: text("source").notNull().default("manual"), // manual|alarm_log|historian|<connector>
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ───────────────────────── PM Program (maintenance loop) ─────────────────────────
// A PM is the OUTPUT of the loop: a corrective repair is closed → a lesson is
// learned → the AI proposes a preventive program → a human approves it. PMs are
// never auto-activated; they require approval (status: draft → active).

export const pmPrograms = sqliteTable("pm_programs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  assetId: text("asset_id"),
  title: text("title").notNull(),
  failureMode: text("failure_mode"), // the failure this PM prevents
  frequencyLabel: text("frequency_label"), // human label e.g. "Monthly", "Every 500 run-hours"
  intervalDays: integer("interval_days"), // numeric cadence for scheduling
  status: text("status").notNull().default("draft"), // draft|active|archived
  estLaborMins: integer("est_labor_mins"),
  tools: text("tools"), // JSON array
  parts: text("parts"), // JSON array
  safety: text("safety"), // JSON array
  reasoning: text("reasoning"), // AI's grounded rationale
  confidence: text("confidence"), // high|medium|low
  source: text("source").notNull().default("ai_suggested"), // ai_suggested|manual
  sourceWorkOrderId: text("source_work_order_id"),
  createdBy: text("created_by"),
  approvedBy: text("approved_by"),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const pmTasks = sqliteTable("pm_tasks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  pmProgramId: text("pm_program_id").notNull(),
  ordinal: integer("ordinal").notNull().default(0),
  // `instruction` remains the human-readable task TITLE (backward compatible).
  instruction: text("instruction").notNull(),
  // `detail` is a JSON blob carrying the rich, structured procedure for this
  // step — purpose, operating state, PPE, tools, parts, procedure, measurements,
  // acceptance criteria, out-of-spec action, est minutes, skill level, OEM refs,
  // failure modes. Nullable so legacy rows (title only) still render.
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const pmSchedules = sqliteTable("pm_schedules", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  pmProgramId: text("pm_program_id").notNull(),
  intervalDays: integer("interval_days").notNull().default(30),
  nextDueAt: integer("next_due_at", { mode: "timestamp_ms" }),
  lastCompletedAt: integer("last_completed_at", { mode: "timestamp_ms" }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const pmCompletions = sqliteTable("pm_completions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  pmProgramId: text("pm_program_id").notNull(),
  scheduleId: text("schedule_id"),
  status: text("status").notNull().default("done"), // done|skipped
  notes: text("notes"),
  completedBy: text("completed_by"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const pmAttachments = sqliteTable("pm_attachments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  pmProgramId: text("pm_program_id").notNull(),
  documentId: text("document_id"),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// The evidence the AI cited when proposing a PM — the audit trail of grounding.
export const pmSourceEvidence = sqliteTable("pm_source_evidence", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  pmProgramId: text("pm_program_id").notNull(),
  kind: text("kind").notNull(), // work_order|lesson|manual|pm_history|oem|model
  refId: text("ref_id"),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ───────────────────────── Parts (Industrial Search foundation) ─────────────────────────
// Minimal parts catalog that everything else can later link to (assets, work
// orders, PMs, suppliers, manuals, failure history). Not an inventory system.

export const parts = sqliteTable("parts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partNumber: text("part_number"),
  manufacturer: text("manufacturer"),
  manufacturerPartNumber: text("manufacturer_part_number"),
  description: text("description").notNull(),
  category: text("category"),
  unit: text("unit").default("each"),
  // ── Field Memory (Phase 2) ──
  replacementNotes: text("replacement_notes"), // free-text "common mistakes", human-written
  criticalSpare: integer("critical_spare", { mode: "boolean" }).notNull().default(false),
  // ── Sourcing (Phase 5) — honest fields, never fake/estimated by the system ──
  preferredSupplier: text("preferred_supplier"),
  supplierUrl: text("supplier_url"),
  manufacturerUrl: text("manufacturer_url"),
  estLeadTime: text("est_lead_time"),
  estPrice: text("est_price"),
  stockQty: integer("stock_qty"),
  reorderPoint: integer("reorder_point"),
  alternatePartNumbers: text("alternate_part_numbers"),
  status: text("status").notNull().default("active"), // active|obsolete
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Generic link table (legacy/back-compat). New code uses the specialized tables.
export const partLinks = sqliteTable("part_links", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  targetType: text("target_type").notNull(), // asset|work_order|pm
  targetId: text("target_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Alternate identifiers for a part — alt part numbers, OEM cross-refs, nicknames.
export const partAliases = sqliteTable("part_aliases", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  alias: text("alias").notNull(),
  kind: text("kind").notNull().default("alt_pn"), // alt_pn|oem|nickname|model
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Which assets use this part (and where on the machine).
export const partAssetLinks = sqliteTable("part_asset_links", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  assetId: text("asset_id").notNull(),
  position: text("position"), // e.g. "drive-end bearing"
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Work orders that used / failed / mentioned this part — powers failure history.
export const partWorkOrderLinks = sqliteTable("part_work_order_links", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  role: text("role").notNull().default("used"), // used|failed|mentioned
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// PMs that inspect this part.
export const partPmLinks = sqliteTable("part_pm_links", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  pmProgramId: text("pm_program_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// The internal evidence behind a part match/usage (honest grounding trail).
export const partSourceEvidence = sqliteTable("part_source_evidence", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  kind: text("kind").notNull(), // alias|work_order|pm|asset|manual|oem
  refId: text("ref_id"),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Suppliers for a part (Phase 5) — names/links/notes only; no live pricing feed.
export const partSuppliers = sqliteTable("part_suppliers", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  partId: text("part_id").notNull(),
  name: text("name").notNull(),
  url: text("url"),
  leadTime: text("lead_time"),
  price: text("price"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ───────────────────────── Scenarios (user-authored plant reality) ─────────────────────────
// A scenario is a real troubleshooting/training case captured from the plant:
// symptom → diagnostic path → root cause → corrective action → lesson. Every
// scenario is org-scoped and owned; it normally belongs to an ASSET (asset-first).
// A scenario without an asset is an explicit "Unassigned draft", never treated as
// complete. NOTHING here is seeded into a real customer org — scenarios exist only
// because a user created them.
export const scenarios = sqliteTable("scenarios", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  title: text("title").notNull(),
  // Asset-first: normally set. Null = "Unassigned draft".
  assetId: text("asset_id"),
  location: text("location"),
  machineType: text("machine_type"),
  symptom: text("symptom"),
  faultCode: text("fault_code"),
  operatingCondition: text("operating_condition"),
  safetyCondition: text("safety_condition"),
  knownHistory: text("known_history"),
  // Related records (all optional refs into this org's own data).
  relatedDocumentId: text("related_document_id"),
  relatedDrawingId: text("related_drawing_id"),
  relatedWorkOrderId: text("related_work_order_id"),
  relatedPmId: text("related_pm_id"),
  relatedPartId: text("related_part_id"),
  // The diagnostic knowledge this scenario teaches.
  expectedDiagnosticPath: text("expected_diagnostic_path"),
  actualRootCause: text("actual_root_cause"),
  correctiveAction: text("corrective_action"),
  lessonLearned: text("lesson_learned"),
  skillLevel: text("skill_level"), // apprentice|junior|mid|senior|lead
  tags: text("tags"), // JSON array
  status: text("status").notNull().default("draft"), // draft|complete|archived
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Scenario = typeof scenarios.$inferSelect;

export type PmProgram = typeof pmPrograms.$inferSelect;
export type PmTask = typeof pmTasks.$inferSelect;
export type PmSchedule = typeof pmSchedules.$inferSelect;
export type PmCompletion = typeof pmCompletions.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type PartAlias = typeof partAliases.$inferSelect;
export type PartAssetLink = typeof partAssetLinks.$inferSelect;
export type PartWorkOrderLink = typeof partWorkOrderLinks.$inferSelect;
export type PartPmLink = typeof partPmLinks.$inferSelect;
export type PartSupplier = typeof partSuppliers.$inferSelect;

export type User = typeof users.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type AssetPhoto = typeof assetPhotos.$inferSelect;
export type AlarmEvent = typeof alarmEvents.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type PlcProject = typeof plcProjects.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type WorkOrderEvent = typeof workOrderEvents.$inferSelect;
export type OemFailureSignal = typeof oemFailureSignals.$inferSelect;
export type Technician = typeof technicians.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Org = typeof orgs.$inferSelect;

// ───────────────────────── Billing / Subscriptions ─────────────────────────

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  plan: text("plan").notNull().default("free_trial"), // free_trial|pro|enterprise
  status: text("status").notNull().default("trialing"), // trialing|active|past_due|canceled|grandfathered
  trialEndsAt: integer("trial_ends_at", { mode: "number" }),
  currentPeriodEnd: integer("current_period_end", { mode: "number" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type SubscriptionRow = typeof subscriptions.$inferSelect;

// ───────────────────────── Shift Handover Notes ─────────────────────────
// Real, user-entered shift-to-shift communication (not a generated digest).
// Org-scoped; optionally linked to an asset / work order / PM / part.
export const handoverNotes = sqliteTable("handover_notes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  category: text("category").notNull().default("watch_item"),
  note: text("note").notNull(),
  priority: text("priority").notNull().default("normal"), // low|normal|high|critical
  status: text("status").notNull().default("open"), // open|resolved
  assetId: text("asset_id"),
  workOrderId: text("work_order_id"),
  pmProgramId: text("pm_program_id"),
  partId: text("part_id"),
  followUpOwner: text("follow_up_owner"),
  shiftLabel: text("shift_label"),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type HandoverNote = typeof handoverNotes.$inferSelect;

// ───────────────────────── AI usage / cost tracking ─────────────────────────
// One row per Copilot answer, org-scoped, for quota enforcement and admin cost
// reporting (per org / user / route / model / mode).
export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("__unset__"),
  userId: text("user_id"),
  route: text("route").notNull().default("chat"),
  model: text("model").notNull().default("deterministic"),
  mode: text("mode").notNull().default("fallback"), // live|fallback|deterministic
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: integer("created_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type AiUsageRow = typeof aiUsage.$inferSelect;

// ───────────────────────── Stripe webhook idempotency ─────────────────────────
// One row per processed Stripe event id, so a redelivered webhook is a no-op.
export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(), // the Stripe event id (evt_...)
  type: text("type").notNull(),
  processedAt: integer("processed_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type StripeEventRow = typeof stripeEvents.$inferSelect;

// ───────────────────────── Work Packages (corrective maintenance) ─────────────────────────
// A work package is a planning artifact attached to a corrective work order.
// It captures the problem statement, suspected failure mode, required parts,
// AI-suggested parts, safety notes, tools, linked docs, and planner approval.
export const workPackages = sqliteTable("work_packages", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  assetId: text("asset_id"),
  problemStatement: text("problem_statement"),
  suspectedFailureMode: text("suspected_failure_mode"),
  safetyNotes: text("safety_notes"), // JSON array
  requiredParts: text("required_parts"), // JSON array [{partId, qty, description, status}]
  suggestedParts: text("suggested_parts"), // JSON array (AI-suggested, pending planner)
  toolsNeeded: text("tools_needed"), // JSON array
  linkedDocuments: text("linked_documents"), // JSON array of document IDs
  troubleshootingSteps: text("troubleshooting_steps"), // JSON array
  plannerApproval: text("planner_approval").notNull().default("pending"), // pending|approved|rejected
  partsAvailability: text("parts_availability").notNull().default("unknown"), // unknown|partial|ready
  readyToWork: integer("ready_to_work").notNull().default(0),
  approvedBy: text("approved_by"),
  approvedAt: integer("approved_at", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "number" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type WorkPackageRow = typeof workPackages.$inferSelect;
