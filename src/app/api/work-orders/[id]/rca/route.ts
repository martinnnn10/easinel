import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { can, type Role } from "@/lib/auth/roles";
import { getRcaByWorkOrder, upsertRca, type RcaInput, type RcaStatus } from "@/lib/rca/repository";
import { rcaConfirmNeedsManager } from "@/lib/rca/policy";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };
const STATUSES: RcaStatus[] = ["draft", "technician_completed", "manager_confirmed"];

// GET /api/work-orders/:id/rca — the structured RCA for this work order (or null).
export const GET = safeHandler("workorders.rca.get", async (_req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const rca = await getRcaByWorkOrder(gate.user.orgId, id);
  return NextResponse.json({ rca });
});

// Shared save path for POST (create-or-update) and PATCH. Filling an RCA needs
// update_work_order (technicians included); CONFIRMING the root cause (or moving
// to manager_confirmed) additionally needs manage_pm — enforced server-side so a
// technician can't confirm by calling the API directly.
async function save(req: NextRequest, ctx: Ctx) {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const role = gate.user.role as Role;
  const isManager = can(role, "manage_pm");

  if (rcaConfirmNeedsManager(body) && !isManager) {
    return NextResponse.json(
      { error: "forbidden", message: "Only a manager or admin can confirm the root cause." },
      { status: 403 }
    );
  }

  // Whitelist input; never trust a client-provided orgId/createdBy/approvedBy.
  const input: RcaInput = {};
  const textKeys = [
    "problemStatement", "symptomObserved", "failedPart", "suspectedCause", "confirmedRootCause",
    "why1", "why2", "why3", "why4", "why5", "correctiveAction", "preventiveAction",
    "verificationMethod", "repeatFailure",
  ] as const;
  for (const k of textKeys) if (typeof body[k] === "string") (input as Record<string, unknown>)[k] = body[k];
  if (typeof body.aiSuggested === "boolean") input.aiSuggested = body.aiSuggested;

  if (typeof body.status === "string" && STATUSES.includes(body.status as RcaStatus)) {
    input.status = body.status as RcaStatus;
    if (body.status === "manager_confirmed") {
      input.approvedBy = gate.user.email;
      input.approvedAt = new Date();
    }
  }

  const rca = await upsertRca(gate.user.orgId, id, input, gate.user.id);
  if (!rca) return NextResponse.json({ error: "not_found", message: "Work order not found." }, { status: 404 });

  // On confirmation, best-effort index the narrative RCA into Knowledge so the
  // Copilot can retrieve it later. Never blocks the save.
  if (rca.status === "manager_confirmed") {
    (async () => {
      try {
        const [{ generateRca }, { saveRca }] = await Promise.all([
          import("@/lib/rca/generate"),
          import("@/lib/rca/save"),
        ]);
        const report = await generateRca(gate.user.orgId, id);
        if (report) await saveRca(gate.user.orgId, report, gate.user.id);
      } catch {
        /* best-effort knowledge indexing */
      }
    })();
  }

  return NextResponse.json({ rca }, { status: 201 });
}

export const POST = safeHandler("workorders.rca.save", save);
export const PATCH = safeHandler("workorders.rca.update", save);
