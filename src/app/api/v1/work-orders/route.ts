import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/apiAuth";
import { createWorkOrder, listWorkOrders } from "@/lib/workorders/repository";

export const runtime = "nodejs";

export const GET = withApiKey(async (req: NextRequest, orgId: string) => {
  const assetId = req.nextUrl.searchParams.get("assetId") || undefined;
  const workOrders = await listWorkOrders(orgId, assetId ? { assetId } : {});
  return NextResponse.json({ workOrders });
});

export const POST = withApiKey(async (req: NextRequest, orgId: string) => {
  const body = await req.json().catch(() => ({}));
  if (!body.title) {
    return NextResponse.json(
      { error: "bad_request", message: "`title` is required." },
      { status: 400 }
    );
  }
  const wo = await createWorkOrder(
    orgId,
    {
      title: body.title,
      description: body.description,
      symptom: body.symptom ?? null,
      assetId: body.assetId ?? null,
      priority: body.priority,
      type: body.type,
      parts: body.parts,
      safety: body.safety,
      source: "api",
    },
    "api"
  );
  return NextResponse.json({ workOrder: wo }, { status: 201 });
});
