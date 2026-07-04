import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import {
  createHandoverNote,
  listHandoverNotes,
  buildNotesDigest,
} from "@/lib/handover/notes";

export const runtime = "nodejs";

// GET /api/handover/notes?hours=12 — this org's entered handover notes + digest.
export const GET = safeHandler("handover.notes.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const h = Number(req.nextUrl.searchParams.get("hours"));
  const windowHours = Number.isFinite(h) && h > 0 && h <= 168 ? h : 12;
  const notes = await listHandoverNotes(gate.user.orgId, windowHours);
  return NextResponse.json({ notes, digest: buildNotesDigest(notes), windowHours });
});

// POST /api/handover/notes — add a real handover note (outgoing shift).
export const POST = safeHandler("handover.notes.create", async (req: NextRequest) => {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body?.note || !String(body.note).trim()) {
    return NextResponse.json({ error: "bad_request", message: "A note is required." }, { status: 400 });
  }
  const note = await createHandoverNote(gate.user.orgId, gate.user.name || gate.user.email, {
    category: body.category,
    note: body.note,
    priority: body.priority,
    assetId: body.assetId ?? null,
    workOrderId: body.workOrderId ?? null,
    pmProgramId: body.pmProgramId ?? null,
    partId: body.partId ?? null,
    followUpOwner: body.followUpOwner ?? null,
    shiftLabel: body.shiftLabel ?? null,
  });
  return NextResponse.json({ note });
});
