import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { getWorkOrder } from "@/lib/workorders/repository";
import { getRcaByWorkOrder } from "@/lib/rca/repository";
import { suggestPmFromWorkOrder } from "@/lib/pm/suggest";
import { createProgram, listPrograms } from "@/lib/pm/repository";
import { evaluatePmFromRca } from "@/lib/rca/policy";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/work-orders/:id/suggest-pm-from-rca — turn a completed RCA into a
// PM DRAFT (never active). update_work_order lets a technician REQUEST the
// draft; a manager approves it later via the PM flow. Only suggests when it
// makes maintenance sense, and never duplicates an existing PM for the same
// failure mode. Every id is validated against the caller's org.
export const POST = safeHandler("workorders.rca.suggestPm", async (_req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const { id } = await ctx.params;

  const wo = await getWorkOrder(orgId, id);
  if (!wo) return NextResponse.json({ error: "not_found", message: "Work order not found." }, { status: 404 });

  const rca = await getRcaByWorkOrder(orgId, id);
  const pms = await listPrograms(orgId);
  const verdict = evaluatePmFromRca(rca, wo, pms);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.code, message: verdict.message, existingPmId: verdict.existingPmId }, { status: verdict.status });
  }
  const cause = (rca!.confirmedRootCause || rca!.suspectedCause || "").trim();

  // The RCA has already synced its cause/part/corrective onto the work order, so
  // the grounded suggester reads one source of truth. createProgram forces
  // status 'draft' — an active PM can never be created here.
  const suggestion = await suggestPmFromWorkOrder(id, orgId);
  if (!suggestion) return NextResponse.json({ error: "not_found", message: "Work order not found." }, { status: 404 });
  const program = await createProgram(orgId, suggestion, gate.user.email);

  try {
    const { logReuseEvent, resolveOriginalAuthor } = await import("@/lib/reuse/events");
    const author = await resolveOriginalAuthor(orgId, id);
    await logReuseEvent(orgId, {
      eventType: "pm_created_from_failure",
      assetId: wo.assetId,
      workOrderId: id,
      sourceType: "pm_program",
      sourceId: program.id,
      surfacedToUserId: gate.user.email,
      originalAuthorUserId: author,
      label: suggestion.failureMode ?? cause,
    });
  } catch {
    /* best-effort reuse logging */
  }

  return NextResponse.json({ program, confidence: suggestion.confidence, rcaId: rca!.id }, { status: 201 });
});
