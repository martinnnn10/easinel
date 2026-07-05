import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";
import { id as genId } from "@/lib/util";

export const runtime = "nodejs";

// GET /api/work-orders/[id]/package — Get work package for a WO
export const GET = safeHandler("workpackage.get", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;

  const [pkg] = await db
    .select()
    .from(schema.workPackages)
    .where(and(eq(schema.workPackages.workOrderId, id), eq(schema.workPackages.orgId, user.orgId)));

  if (!pkg) {
    return NextResponse.json({ package: null });
  }

  return NextResponse.json({
    package: {
      ...pkg,
      safetyNotes: pkg.safetyNotes ? JSON.parse(pkg.safetyNotes) : [],
      requiredParts: pkg.requiredParts ? JSON.parse(pkg.requiredParts) : [],
      suggestedParts: pkg.suggestedParts ? JSON.parse(pkg.suggestedParts) : [],
      toolsNeeded: pkg.toolsNeeded ? JSON.parse(pkg.toolsNeeded) : [],
      linkedDocuments: pkg.linkedDocuments ? JSON.parse(pkg.linkedDocuments) : [],
      troubleshootingSteps: pkg.troubleshootingSteps ? JSON.parse(pkg.troubleshootingSteps) : [],
    },
  });
});

// POST /api/work-orders/[id]/package — Create or update work package
export const POST = safeHandler("workpackage.upsert", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id: woId } = await params;

  const body = await req.json();

  // Verify WO belongs to org
  const [wo] = await db
    .select()
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.id, woId), eq(schema.workOrders.orgId, user.orgId)));

  if (!wo) {
    return NextResponse.json({ error: "not_found", message: "Work order not found" }, { status: 404 });
  }

  // Check if package already exists
  const [existing] = await db
    .select()
    .from(schema.workPackages)
    .where(and(eq(schema.workPackages.workOrderId, woId), eq(schema.workPackages.orgId, user.orgId)));

  const values = {
    problemStatement: body.problemStatement ?? null,
    suspectedFailureMode: body.suspectedFailureMode ?? null,
    safetyNotes: body.safetyNotes ? JSON.stringify(body.safetyNotes) : null,
    requiredParts: body.requiredParts ? JSON.stringify(body.requiredParts) : null,
    suggestedParts: body.suggestedParts ? JSON.stringify(body.suggestedParts) : null,
    toolsNeeded: body.toolsNeeded ? JSON.stringify(body.toolsNeeded) : null,
    linkedDocuments: body.linkedDocuments ? JSON.stringify(body.linkedDocuments) : null,
    troubleshootingSteps: body.troubleshootingSteps ? JSON.stringify(body.troubleshootingSteps) : null,
    assetId: body.assetId ?? wo.assetId ?? null,
    updatedAt: Date.now(),
  };

  if (existing) {
    await db
      .update(schema.workPackages)
      .set(values)
      .where(eq(schema.workPackages.id, existing.id));
    return NextResponse.json({ id: existing.id, updated: true });
  }

  const pkgId = genId("wpkg");
  await db.insert(schema.workPackages).values({
    id: pkgId,
    orgId: user.orgId,
    workOrderId: woId,
    ...values,
    plannerApproval: "pending",
    partsAvailability: "unknown",
    readyToWork: 0,
    createdAt: Date.now(),
  });

  return NextResponse.json({ id: pkgId, created: true }, { status: 201 });
});
