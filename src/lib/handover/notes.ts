import { db, ensureDb } from "@/lib/db";
import { handoverNotes, assets, workOrders, type HandoverNote } from "@/lib/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";
import { id } from "@/lib/util";

// Real shift-to-shift handover notes. Everything here is STRICTLY org-scoped:
// every read and write filters by orgId (taken from the session, never the
// client), so one plant can never see or touch another's handover board.

export const HANDOVER_CATEGORIES = [
  { key: "machine_down", label: "Machine down" },
  { key: "watch_item", label: "Watch item" },
  { key: "safety", label: "Safety concern" },
  { key: "parts_needed", label: "Parts needed" },
  { key: "carried_over", label: "Work carried over" },
  { key: "pm_issue", label: "PM missed / deferred" },
  { key: "temp_fix", label: "Temporary fix" },
  { key: "operator_complaint", label: "Operator complaint" },
  { key: "supervisor_note", label: "Supervisor note" },
] as const;

export type HandoverCategory = (typeof HANDOVER_CATEGORIES)[number]["key"];
const VALID_CATEGORIES = new Set<string>(HANDOVER_CATEGORIES.map((c) => c.key));
const VALID_PRIORITIES = new Set<string>(["low", "normal", "high", "critical"]);

export interface HandoverNoteInput {
  category: string;
  note: string;
  priority?: string;
  assetId?: string | null;
  workOrderId?: string | null;
  pmProgramId?: string | null;
  partId?: string | null;
  followUpOwner?: string | null;
  shiftLabel?: string | null;
}

export interface HandoverNoteView extends HandoverNote {
  assetName?: string | null;
  workOrderNumber?: string | null;
}

export async function createHandoverNote(
  orgId: string,
  actor: string,
  input: HandoverNoteInput
): Promise<HandoverNote> {
  if (!orgId) throw new Error("createHandoverNote() requires orgId");
  const note = (input.note ?? "").trim();
  if (!note) throw new Error("A note is required.");
  const category = VALID_CATEGORIES.has(input.category) ? input.category : "watch_item";
  const priority = VALID_PRIORITIES.has(input.priority ?? "") ? input.priority! : "normal";
  await ensureDb();

  // Defense in depth: a linked asset/work order must belong to THIS org, or the
  // link is dropped — a note can never reference another tenant's records.
  const assetId = await scopedRef(orgId, "asset", input.assetId);
  const workOrderId = await scopedRef(orgId, "workOrder", input.workOrderId);

  const noteId = id("hnote");
  await db.insert(handoverNotes).values({
    id: noteId,
    orgId,
    category,
    note: note.slice(0, 4000),
    priority,
    status: "open",
    assetId,
    workOrderId,
    pmProgramId: input.pmProgramId ?? null,
    partId: input.partId ?? null,
    followUpOwner: (input.followUpOwner ?? "").trim().slice(0, 120) || null,
    shiftLabel: (input.shiftLabel ?? "").trim().slice(0, 60) || null,
    createdBy: actor,
  });
  const rows = await db.select().from(handoverNotes).where(eq(handoverNotes.id, noteId));
  return rows[0];
}

async function scopedRef(
  orgId: string,
  kind: "asset" | "workOrder",
  refId?: string | null
): Promise<string | null> {
  if (!refId) return null;
  if (kind === "asset") {
    const r = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.id, refId)));
    return r[0]?.id ?? null;
  }
  const r = await db.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, refId)));
  return r[0]?.id ?? null;
}

// List notes for THIS org created within the last `windowHours`, newest first,
// with the linked asset name / work-order number joined in (org-scoped join).
export async function listHandoverNotes(
  orgId: string,
  windowHours = 12
): Promise<HandoverNoteView[]> {
  if (!orgId) throw new Error("listHandoverNotes() requires orgId");
  await ensureDb();
  const since = Date.now() - windowHours * 3600_000;
  const rows = await db
    .select()
    .from(handoverNotes)
    .where(and(eq(handoverNotes.orgId, orgId), gte(handoverNotes.createdAt, since)))
    .orderBy(desc(handoverNotes.createdAt));

  // Resolve linked names within the same org (small N — one pass).
  const out: HandoverNoteView[] = [];
  for (const r of rows) {
    let assetName: string | null = null;
    let workOrderNumber: string | null = null;
    if (r.assetId) {
      const a = await db.select({ name: assets.name }).from(assets).where(and(eq(assets.orgId, orgId), eq(assets.id, r.assetId)));
      assetName = a[0]?.name ?? null;
    }
    if (r.workOrderId) {
      const w = await db.select({ number: workOrders.number, title: workOrders.title }).from(workOrders).where(and(eq(workOrders.orgId, orgId), eq(workOrders.id, r.workOrderId)));
      workOrderNumber = w[0]?.number ?? w[0]?.title ?? null;
    }
    out.push({ ...r, assetName, workOrderNumber });
  }
  return out;
}

export async function resolveHandoverNote(orgId: string, noteId: string, resolved: boolean): Promise<void> {
  if (!orgId) throw new Error("resolveHandoverNote() requires orgId");
  await ensureDb();
  await db
    .update(handoverNotes)
    .set({ status: resolved ? "resolved" : "open" })
    .where(and(eq(handoverNotes.orgId, orgId), eq(handoverNotes.id, noteId)));
}

export async function deleteHandoverNote(orgId: string, noteId: string): Promise<void> {
  if (!orgId) throw new Error("deleteHandoverNote() requires orgId");
  await ensureDb();
  await db.delete(handoverNotes).where(and(eq(handoverNotes.orgId, orgId), eq(handoverNotes.id, noteId)));
}

// Build a clean shift digest FROM the entered notes (grouped by category).
export function buildNotesDigest(notes: HandoverNoteView[]): string {
  if (!notes.length) return "";
  const byCat = new Map<string, HandoverNoteView[]>();
  for (const n of notes) {
    if (!byCat.has(n.category)) byCat.set(n.category, []);
    byCat.get(n.category)!.push(n);
  }
  const lines: string[] = [];
  for (const cat of HANDOVER_CATEGORIES) {
    const group = byCat.get(cat.key);
    if (!group || !group.length) continue;
    lines.push(`### ${cat.label}`);
    for (const n of group) {
      const link = n.assetName ? ` _(‎${n.assetName})_` : "";
      const wo = n.workOrderNumber ? ` [${n.workOrderNumber}]` : "";
      const pri = n.priority === "critical" || n.priority === "high" ? ` **[${n.priority.toUpperCase()}]**` : "";
      const owner = n.followUpOwner ? ` → ${n.followUpOwner}` : "";
      const status = n.status === "resolved" ? " ✓" : "";
      lines.push(`- ${n.note}${link}${wo}${pri}${owner}${status}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
