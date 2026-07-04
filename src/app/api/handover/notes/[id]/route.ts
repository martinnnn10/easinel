import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { deleteHandoverNote, resolveHandoverNote } from "@/lib/handover/notes";

export const runtime = "nodejs";

// PATCH /api/handover/notes/:id — mark resolved / reopen (org-scoped).
export const PATCH = safeHandler("handover.notes.patch", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  await resolveHandoverNote(gate.user.orgId, id, body?.status === "resolved");
  return NextResponse.json({ ok: true });
});

// DELETE /api/handover/notes/:id — remove a note (org-scoped).
export const DELETE = safeHandler("handover.notes.delete", async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  await deleteHandoverNote(gate.user.orgId, id);
  return NextResponse.json({ ok: true });
});
