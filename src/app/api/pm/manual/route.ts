import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";
import { id as genId } from "@/lib/util";

export const runtime = "nodejs";

const FREQUENCY_PRESETS: Record<string, number> = {
  "30-day": 30,
  "60-day": 60,
  "90-day": 90,
  monthly: 30,
  quarterly: 90,
  "semi-annual": 182,
  annual: 365,
};

// POST /api/pm/manual — Create a manual PM program (no AI, always draft)
export const POST = safeHandler("pm.manual", async (req: NextRequest) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await req.json();
  const {
    assetId,
    title,
    frequency,
    intervalDays: customInterval,
    estLaborMins,
    estDowntimeMins,
    tools,
    parts,
    safety,
    tasks,
  } = body;

  if (!assetId || !title || !frequency) {
    return NextResponse.json(
      { error: "validation_failed", message: "assetId, title, and frequency are required" },
      { status: 400 }
    );
  }

  // Validate asset belongs to org
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.orgId, user.orgId)));
  if (!asset) {
    return NextResponse.json({ error: "not_found", message: "Asset not found" }, { status: 404 });
  }

  const intervalDays = customInterval || FREQUENCY_PRESETS[frequency] || 30;
  const pmId = genId("pm");

  await db.insert(schema.pmPrograms).values({
    id: pmId,
    orgId: user.orgId,
    assetId,
    title,
    failureMode: body.failureMode || null,
    frequencyLabel: frequency,
    intervalDays,
    status: "draft",
    estLaborMins: estLaborMins || null,
    tools: tools ? JSON.stringify(tools) : null,
    parts: parts ? JSON.stringify(parts) : null,
    safety: safety ? JSON.stringify(safety) : null,
    source: "manual",
    createdBy: user.email,
    confidence: null,
    reasoning: null,
    sourceWorkOrderId: null,
    approvedBy: null,
    approvedAt: null,
  });

  // Create tasks if provided
  if (tasks && Array.isArray(tasks)) {
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      await db.insert(schema.pmTasks).values({
        id: genId("pmt"),
        orgId: user.orgId,
        pmProgramId: pmId,
        ordinal: i + 1,
        instruction: typeof t === "string" ? t : (t.instruction || t.title || `Step ${i + 1}`),
        detail: typeof t === "object" && t.detail ? JSON.stringify(t.detail) : null,
      });
    }
  }

  // NO schedule here. A manual PM is born a DRAFT and must not generate due work
  // until a manager/admin approves it — approveProgram() creates the active
  // schedule, exactly like the AI-suggested path. Creating a schedule at draft
  // time would let unapproved PMs fire as "due".
  return NextResponse.json({ id: pmId, status: "draft" }, { status: 201 });
});
