import { NextRequest, NextResponse } from "next/server";
import { getScenario, updateScenario, deleteScenario } from "@/lib/scenarios/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const UpdateScenarioSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    symptom: z.string().max(8000).optional().nullable(),
    assetId: z.string().trim().optional().nullable(),
    location: z.string().trim().max(300).optional().nullable(),
    machineType: z.string().trim().max(120).optional().nullable(),
    faultCode: z.string().trim().max(120).optional().nullable(),
    operatingCondition: z.string().max(2000).optional().nullable(),
    safetyCondition: z.string().max(2000).optional().nullable(),
    knownHistory: z.string().max(8000).optional().nullable(),
    relatedDocumentId: z.string().trim().optional().nullable(),
    relatedDrawingId: z.string().trim().optional().nullable(),
    relatedWorkOrderId: z.string().trim().optional().nullable(),
    relatedPmId: z.string().trim().optional().nullable(),
    relatedPartId: z.string().trim().optional().nullable(),
    expectedDiagnosticPath: z.string().max(8000).optional().nullable(),
    actualRootCause: z.string().max(8000).optional().nullable(),
    correctiveAction: z.string().max(8000).optional().nullable(),
    lessonLearned: z.string().max(8000).optional().nullable(),
    skillLevel: z.enum(["apprentice", "junior", "mid", "senior", "lead"]).optional().nullable(),
    tags: z.array(z.string()).max(50).optional().nullable(),
    status: z.enum(["draft", "complete", "archived"]).optional(),
  })
  .passthrough();

// GET /api/scenarios/:id — org-scoped (a scenario id alone can't reach another
// tenant's scenario).
export const GET = safeHandler("scenarios.get", async (_req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const scenario = await getScenario(gate.user.orgId, id);
  if (!scenario) return NextResponse.json({ error: "not_found", message: "Scenario not found." }, { status: 404 });
  return NextResponse.json({ scenario });
});

// PATCH /api/scenarios/:id — edit. RBAC: manage_scenarios.
export const PATCH = safeHandler("scenarios.update", async (req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("manage_scenarios");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const parsed = await parseBody(req, UpdateScenarioSchema);
  if (parsed.response) return parsed.response;
  const scenario = await updateScenario(gate.user.orgId, id, parsed.data, gate.user.id);
  if (!scenario) return NextResponse.json({ error: "not_found", message: "Scenario not found." }, { status: 404 });
  return NextResponse.json({ scenario });
});

// DELETE /api/scenarios/:id — remove. RBAC: manage_scenarios.
export const DELETE = safeHandler("scenarios.delete", async (_req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("manage_scenarios");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const ok = await deleteScenario(gate.user.orgId, id, gate.user.id);
  if (!ok) return NextResponse.json({ error: "not_found", message: "Scenario not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
