import { NextRequest, NextResponse } from "next/server";
import { saveLesson } from "@/lib/lessons";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

const LessonSchema = z
  .object({
    problem: z.string().trim().min(1, "problem is required").max(20000),
    resolution: z.string().trim().min(1, "resolution is required").max(50000),
    title: z.string().max(300).optional().nullable(),
    assetId: z.string().trim().optional().nullable(),
  })
  .passthrough();

// POST /api/lessons — persist a resolved diagnosis as a retrievable lesson learned.
export const POST = safeHandler("lessons.create", async (req: NextRequest) => {
  const gate = await requirePermission("ask_copilot");
  if (gate instanceof NextResponse) return gate;
  const parsed = await parseBody(req, LessonSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const problem = body.problem.trim();
  const resolution = body.resolution.trim();
  const result = await saveLesson(gate.user.orgId, {
    title: body.title || problem,
    problem,
    resolution,
    assetId: body.assetId ?? null,
  });
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
});
