import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// PATCH /api/pm/[id]/approve — Approve a draft PM program (activates it)
export const PATCH = safeHandler("pm.approve", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;

  const [pm] = await db
    .select()
    .from(schema.pmPrograms)
    .where(and(eq(schema.pmPrograms.id, id), eq(schema.pmPrograms.orgId, user.orgId)));

  if (!pm) {
    return NextResponse.json({ error: "not_found", message: "PM program not found" }, { status: 404 });
  }
  if (pm.status !== "draft") {
    return NextResponse.json(
      { error: "invalid_state", message: `Cannot approve a PM in '${pm.status}' status` },
      { status: 400 }
    );
  }

  await db
    .update(schema.pmPrograms)
    .set({
      status: "active",
      approvedBy: user.email,
      approvedAt: new Date(),
    })
    .where(and(eq(schema.pmPrograms.id, id), eq(schema.pmPrograms.orgId, user.orgId)));

  // Knowledge reuse (best-effort): a PM that grew out of a documented failure was
  // approved — preventive work is now live because someone captured the failure.
  if (pm.sourceWorkOrderId) {
    try {
      const { logReuseEvent, resolveOriginalAuthor } = await import("@/lib/reuse/events");
      const author = await resolveOriginalAuthor(user.orgId, pm.sourceWorkOrderId);
      await logReuseEvent(user.orgId, {
        eventType: "pm_approved_from_failure",
        assetId: pm.assetId ?? null,
        workOrderId: pm.sourceWorkOrderId,
        sourceType: "pm_program",
        sourceId: pm.id,
        surfacedToUserId: user.email,
        originalAuthorUserId: author,
        label: pm.failureMode ?? pm.title,
      });
    } catch {
      /* best-effort */
    }
  }

  return NextResponse.json({ id, status: "active" });
});
