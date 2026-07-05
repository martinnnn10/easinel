import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";
import { id as genId } from "@/lib/util";

export const runtime = "nodejs";

// POST /api/pm/[id]/generate-wo — Generate a work order from a due PM
export const POST = safeHandler("pm.generate-wo", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;

  // Verify PM exists and belongs to org
  const [pm] = await db
    .select()
    .from(schema.pmPrograms)
    .where(and(eq(schema.pmPrograms.id, id), eq(schema.pmPrograms.orgId, user.orgId)));

  if (!pm) {
    return NextResponse.json({ error: "not_found", message: "PM program not found" }, { status: 404 });
  }

  // Get asset name for the WO title
  let assetName = "Unknown Asset";
  if (pm.assetId) {
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, pm.assetId), eq(schema.assets.orgId, user.orgId)));
    if (asset) assetName = asset.name;
  }

  // Create the work order
  const woId = genId("wo");
  const now = Date.now();
  await db.insert(schema.workOrders).values({
    id: woId,
    orgId: user.orgId,
    title: `PM: ${pm.title}`,
    symptom: `Scheduled preventive maintenance — ${pm.frequencyLabel || pm.intervalDays + "-day"} interval`,
    status: "open",
    priority: "medium",
    type: "pm",
    assetId: pm.assetId,
    reportedAt: new Date(now),
  });

  return NextResponse.json({ workOrderId: woId, title: `PM: ${pm.title}`, asset: assetName }, { status: 201 });
});
