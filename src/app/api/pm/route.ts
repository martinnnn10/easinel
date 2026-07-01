import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { listPrograms, listDue, createProgram } from "@/lib/pm/repository";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

const CreatePmSchema = z
  .object({
    title: z.string().trim().min(1, "title is required").max(300),
    assetId: z.string().trim().optional().nullable(),
    failureMode: z.string().max(2000).optional().nullable(),
    frequencyLabel: z.string().max(200).optional().nullable(),
    intervalDays: z.number().int().positive().max(100000).optional(),
    estLaborMins: z.number().int().nonnegative().max(100000).optional().nullable(),
    tools: z.array(z.string()).optional(),
    parts: z.array(z.string()).optional(),
    safety: z.array(z.string()).optional(),
    tasks: z.array(z.any()).optional(),
  })
  .passthrough();

// GET /api/pm?status=draft|active|archived&due=1
export const GET = safeHandler("pm.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const status = req.nextUrl.searchParams.get("status") || undefined;
  const due = req.nextUrl.searchParams.get("due");
  const programs = due ? await listDue(orgId) : await listPrograms(orgId, status);
  return NextResponse.json({ programs });
});

// POST /api/pm — create a manual draft PM (still requires approval to activate).
export const POST = safeHandler("pm.create", async (req: NextRequest) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const parsed = await parseBody(req, CreatePmSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  // Asset-first rule: a PM must belong to a machine. Reject orphan PMs at the
  // edge with an actionable message instead of letting the repository throw.
  if (!body.assetId) {
    return NextResponse.json(
      { error: "A PM must belong to a machine. Select or create the asset first, then attach the PM to it." },
      { status: 400 }
    );
  }
  const program = await createProgram(
    gate.user.orgId,
    {
      title: body.title,
      assetId: body.assetId ?? null,
      failureMode: body.failureMode ?? null,
      frequencyLabel: body.frequencyLabel ?? null,
      intervalDays: body.intervalDays ?? 90,
      estLaborMins: body.estLaborMins ?? null,
      tools: body.tools,
      parts: body.parts,
      safety: body.safety,
      tasks: body.tasks,
      source: "manual",
    },
    gate.user.email
  );
  return NextResponse.json({ program }, { status: 201 });
});
