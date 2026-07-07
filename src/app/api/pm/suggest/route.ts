import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { suggestPmFromWorkOrder } from "@/lib/pm/suggest";
import { createProgram } from "@/lib/pm/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/pm/suggest  { workOrderId }
// "Should this become a PM?" — generates a GROUNDED draft PM from a closed work
// order and saves it as `draft` (awaiting human approval). Never activates.
export const POST = safeHandler("pm.suggest", async (req: NextRequest) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body.workOrderId) {
    return NextResponse.json({ error: "workOrderId required" }, { status: 400 });
  }
  const suggestion = await suggestPmFromWorkOrder(body.workOrderId, gate.user.orgId);
  if (!suggestion) {
    return NextResponse.json({ error: "work order not found" }, { status: 404 });
  }
  // Asset-first rule: a PM must belong to a machine. A work order with no asset
  // can't become a PM until it's linked to one — guide the user there instead of
  // silently creating an orphan PM.
  if (!suggestion.assetId) {
    return NextResponse.json(
      { error: "This work order isn't linked to a machine. Assign an asset to the work order first, then turn it into a PM." },
      { status: 422 }
    );
  }
  const program = await createProgram(gate.user.orgId, suggestion, gate.user.email);

  // Knowledge reuse (best-effort): this preventive program was born from a real
  // recurring failure. Credit the technician who documented that failure so the
  // impact of writing it down is visible. Never blocks the create.
  try {
    const { logReuseEvent, resolveOriginalAuthor } = await import("@/lib/reuse/events");
    const author = suggestion.sourceWorkOrderId
      ? await resolveOriginalAuthor(gate.user.orgId, suggestion.sourceWorkOrderId)
      : null;
    await logReuseEvent(gate.user.orgId, {
      eventType: "pm_created_from_failure",
      assetId: suggestion.assetId ?? null,
      workOrderId: suggestion.sourceWorkOrderId ?? null,
      sourceType: "pm_program",
      sourceId: program.id,
      surfacedToUserId: gate.user.email,
      originalAuthorUserId: author,
      label: suggestion.failureMode ?? suggestion.title,
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ program, confidence: suggestion.confidence, evidenceCount: suggestion.evidenceCount }, { status: 201 });
});
