/**
 * Audit-trail read layer — the compliance surface over the append-only
 * audit_log. Turns raw {actor, action, target, detail, at} rows into readable,
 * attributed activity for a manager/auditor: who did what, when. Strictly
 * org-scoped; nothing here writes or invents — it only reads real recorded
 * events. Actor strings (a user id OR an email, depending on the write site)
 * resolve to a display name; system/anonymous actors are labelled honestly.
 */

import { db, ensureDb } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { and, eq, gte, desc, notLike } from "drizzle-orm";

// Human-readable labels for the recorded actions. Unknown actions fall back to
// a de-underscored version so a new event type is never blank.
export const AUDIT_LABEL: Record<string, string> = {
  "workorder.created": "Created work order",
  "workorder.requested": "Submitted work request",
  "workorder.approved": "Approved work order",
  "workorder.rejected": "Rejected work request",
  "workorder.updated": "Updated work order",
  "workorder.status_changed": "Changed work-order status",
  "workorder.synced": "Synced work order to CMMS",
  "workorder.deleted": "Deleted work order",
  "pm.created": "Created PM program",
  "pm.approved": "Approved PM program",
  "pm.completed": "Completed PM",
  "pm.archived": "Archived PM program",
  "pm.asset_assigned": "Assigned PM to asset",
  "asset.created": "Added asset",
  "asset.updated": "Updated asset",
  "asset.deleted": "Deleted asset",
  "asset.retired": "Retired asset",
  "asset.photo_added": "Added asset photo",
  "alarm.recorded": "Recorded alarm",
  "part.created": "Added part",
  "part.updated": "Updated part",
  "part.linked_asset": "Linked part to asset",
  "part.linked_work_order": "Linked part to work order",
  "part.linked_pm": "Linked part to PM",
  "part.supplier_added": "Added part supplier",
  "scenario.created": "Created scenario",
  "scenario.updated": "Updated scenario",
  "scenario.deleted": "Deleted scenario",
  "rca.saved": "Saved root-cause analysis",
  "document.ingest": "Uploaded document",
  "document.reprocess": "Reprocessed document",
  "document.archived": "Archived document",
  "memory.captured": "Captured machine memory",
  "member.role_change": "Changed member role",
  "member.remove": "Removed member",
  "invite.create": "Invited member",
  "invitation.revoked": "Revoked invitation",
  "org.rename": "Renamed organization",
  "org.downtime_rate": "Set downtime cost rate",
  "integration.connected": "Connected integration",
  "integration.synced": "Synced integration",
  "integration.pm_pushed": "Pushed PM to CMMS",
};

// Coarse category for filtering/coloring in the UI.
export function auditCategory(action: string): "work_order" | "pm" | "asset" | "part" | "knowledge" | "admin" | "integration" | "other" {
  const head = action.split(".")[0];
  switch (head) {
    case "workorder": return "work_order";
    case "pm": return "pm";
    case "asset":
    case "alarm": return "asset";
    case "part": return "part";
    case "scenario":
    case "rca":
    case "document":
    case "memory": return "knowledge";
    case "member":
    case "invite":
    case "invitation":
    case "org": return "admin";
    case "integration": return "integration";
    default: return "other";
  }
}

export function auditLabel(action: string): string {
  return AUDIT_LABEL[action] ?? action.replace(/[._]/g, " ");
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string; // raw actor string (id/email/"system")
  actorName: string; // resolved display name, or a friendly system label
  action: string;
  label: string;
  category: ReturnType<typeof auditCategory>;
  target: string | null;
  detail: string | null;
}

export interface AuditFilters {
  target?: string;
  actor?: string;
  category?: string;
  sinceDays?: number;
  limit?: number;
}

function friendlyActor(actor: string, name: string | null): string {
  if (name) return name;
  if (actor === "system") return "System";
  if (actor === "user") return "A user";
  if (actor.startsWith("cleanup-script")) return "Cleanup script";
  return actor; // an email/id with no matching member (e.g. removed user)
}

export async function listAuditLog(orgId: string, filters: AuditFilters = {}): Promise<AuditEntry[]> {
  if (!orgId) throw new Error("listAuditLog() requires orgId");
  await ensureDb();

  // Exclude the `event.*` rows: emitEvent() mirrors every domain event into the
  // audit_log for webhook bookkeeping, which would double every real action with
  // a redundant "system" entry. The human-attributed audit() row is the record.
  const conds = [eq(auditLog.orgId, orgId), notLike(auditLog.action, "event.%")];
  if (filters.target) conds.push(eq(auditLog.target, filters.target));
  if (filters.actor) conds.push(eq(auditLog.actor, filters.actor));
  if (filters.sinceDays && filters.sinceDays > 0) {
    conds.push(gte(auditLog.at, new Date(Date.now() - filters.sinceDays * 86400_000)));
  }

  const wantLimit = Math.min(2000, Math.max(1, filters.limit ?? 200));
  // `category` is derived from `action` (not a column), so it is filtered in JS.
  // When a category is requested, fetch a wider window first and slice AFTER
  // filtering — otherwise ?category=pm&limit=50 would fetch 50 rows of ANY
  // category and then filter down to a handful, hiding older matching rows.
  const fetchLimit = filters.category ? 2000 : wantLimit;
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.at))
    .limit(fetchLimit);

  // Resolve actor → member name (actor may be a user id OR an email).
  const members = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.orgId, orgId));
  const byId = new Map(members.map((m) => [m.id, m.name]));
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.name]));

  const entries = rows.map((r) => {
    const name = byId.get(r.actor) ?? byEmail.get(r.actor.toLowerCase()) ?? null;
    const at = r.at instanceof Date ? r.at.getTime() : Number(r.at);
    return {
      id: r.id,
      at,
      actor: r.actor,
      actorName: friendlyActor(r.actor, name),
      action: r.action,
      label: auditLabel(r.action),
      category: auditCategory(r.action),
      target: r.target,
      detail: r.detail,
    };
  });

  const filtered = filters.category ? entries.filter((e) => e.category === filters.category) : entries;
  return filtered.slice(0, wantLimit);
}

// RFC-4180-ish CSV for auditor export. Quotes every field, escapes quotes, and
// neutralizes CSV formula injection (a cell starting with = + - @ tab or CR is
// prefixed with an apostrophe so Excel/Sheets treat it as text, not a formula).
export function auditLogCsv(entries: AuditEntry[]): string {
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["Timestamp (UTC)", "Who", "Action", "Category", "Target", "Detail"].map(esc).join(",");
  const lines = entries.map((e) =>
    [new Date(e.at).toISOString(), e.actorName, e.label, e.category, e.target ?? "", e.detail ?? ""].map(esc).join(",")
  );
  return [header, ...lines].join("\r\n");
}
