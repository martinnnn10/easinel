import { NextRequest, NextResponse } from "next/server";
import { listPlcProjects } from "@/lib/plc/store";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/plc            → all parsed PLC projects
// GET /api/plc?assetId=…  → PLC projects for one asset
export const GET = safeHandler("plc.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const assetId = req.nextUrl.searchParams.get("assetId");
  try {
    const projects = await listPlcProjects(gate.user.orgId, assetId);
    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, projects: [] }, { status: 500 });
  }
});
