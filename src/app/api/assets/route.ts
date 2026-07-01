import { NextRequest, NextResponse } from "next/server";
import { listAssets, createAsset, type AssetFilters, type AssetInput } from "@/lib/assets/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

// Validate the constrained fields (name + the closed enums) strictly so a bad
// value is a clear 400, not a silent default. Everything else passes through
// untouched to the repository (which sanitizes the rest).
const CreateAssetSchema = z
  .object({
    name: z.string().trim().min(1, "a name is required").max(300),
    status: z.enum(["operational", "degraded", "down", "maintenance", "retired"]).optional().nullable(),
    criticality: z.enum(["low", "medium", "high", "critical"]).optional().nullable(),
    assetLevel: z.enum(["site", "area", "line", "machine", "component", "part"]).optional().nullable(),
  })
  .passthrough();

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

  const parsed = await parseBody(req, CreateAssetSchema);
  if (parsed.response) return parsed.response;

  // Validated known fields + passthrough rest; the repository sanitizes further.
  const asset = await createAsset(user.orgId, parsed.data as unknown as AssetInput, user.email);
  return NextResponse.json({ asset }, { status: 201 });
});
