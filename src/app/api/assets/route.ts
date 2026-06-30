import { NextRequest, NextResponse } from "next/server";
import { listAssets, createAsset, type AssetFilters } from "@/lib/assets/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// List assets. All roles can view; filters are passed through to the repository.
export const GET = safeHandler("assets.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;

  const sp = req.nextUrl.searchParams;
  const filters: AssetFilters = {};
  for (const k of ["site", "area", "line", "status", "criticality", "assetType", "parentAssetId", "search"] as const) {
    const v = sp.get(k);
    if (v) filters[k] = v;
  }
  if (sp.get("rootsOnly") === "1" || sp.get("rootsOnly") === "true") filters.rootsOnly = true;
  try {
    const assets = await listAssets(orgId, filters);
    return NextResponse.json({ assets });
  } catch (err) {
    console.error("GET /api/assets failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to load assets." }, { status: 500 });
  }
});

// Create an asset. technician+ (manage_assets).
export const POST = safeHandler("assets.create", async (req: NextRequest) => {
  const gate = await requirePermission("manage_assets");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "bad_request", message: "Name is required." }, { status: 400 });
  }
  try {
    const asset = await createAsset(user.orgId, body as never, user.email);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    console.error("POST /api/assets failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to create asset." }, { status: 500 });
  }
});
