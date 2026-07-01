import { NextRequest, NextResponse } from "next/server";
import { listScenarios, createScenario, type ScenarioFilters } from "@/lib/scenarios/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

// A scenario needs at least a handle on what it is: a title or a symptom.
const CreateScenarioSchema = z
  .object({
    title: z.string().trim().max(300).optional(),
    symptom: z.string().trim().max(8000).optional().nullable(),
    assetId: z.string().trim().optional().nullable(),
    location: z.string().trim().max(300).optional().nullable(),
    machineType: z.string().trim().max(120).optional().nullable(),
    faultCode: z.string().trim().max(120).optional().nullable(),
    operatingCondition: z.string().trim().max(2000).optional().nullable(),
    safetyCondition: z.string().trim().max(2000).optional().nullable(),
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
  .refine((b) => Boolean(b.title?.trim() || b.symptom?.trim()), {
    message: "a title or a symptom is required",
    path: ["title"],
  });

// GET /api/scenarios?assetId=&status=&search= — this org's scenarios only.
export const GET = safeHandler("scenarios.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const sp = req.nextUrl.searchParams;
  const filters: ScenarioFilters = {};
  if (sp.get("assetId")) filters.assetId = sp.get("assetId")!;
  const st = sp.get("status");
  if (st === "draft" || st === "complete" || st === "archived" || st === "all") filters.status = st;
  if (sp.get("search")) filters.search = sp.get("search")!;
  const scenarios = await listScenarios(gate.user.orgId, filters);
  return NextResponse.json({ scenarios });
});

// POST /api/scenarios — create a scenario in THIS org (server sets the org from
// the session; a client-supplied orgId is never trusted). RBAC: manage_scenarios.
export const POST = safeHandler("scenarios.create", async (req: NextRequest) => {
  const gate = await requirePermission("manage_scenarios");
  if (gate instanceof NextResponse) return gate;
  const parsed = await parseBody(req, CreateScenarioSchema);
  if (parsed.response) return parsed.response;
  const scenario = await createScenario(gate.user.orgId, parsed.data, gate.user.id);
  return NextResponse.json({ scenario }, { status: 201 });
});
