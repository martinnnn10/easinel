import { NextRequest, NextResponse } from "next/server";
import { assignProgramAsset, getProgram } from "@/lib/pm/repository";
import { createAsset } from "@/lib/assets/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Assign a PM to an asset. Two modes:
//   { assetId }              → link the PM to an existing asset
//   { createAsset: {...} }   → create a new asset (editable number + optional
//                              parent/level), then link the PM to it
// Both require manage_pm and are strictly org-scoped.
export const POST = safeHandler("pm.assign", async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id: pmId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }

  try {
    let assetId: string | null = null;

    if (body.assetId === null) {
      assetId = null; // explicit unassign
    } else if (typeof body.assetId === "string" && body.assetId.trim()) {
      assetId = body.assetId.trim();
    } else if (body.createAsset && typeof body.createAsset === "object") {
      const c = body.createAsset as Record<string, unknown>;
      if (!c.name || typeof c.name !== "string" || !c.name.trim()) {
        return NextResponse.json({ error: "bad_request", message: "New asset requires a name." }, { status: 400 });
      }
      const created = await createAsset(
        user.orgId,
        {
          name: (c.name as string).trim(),
          assetTag: (c.assetTag as string) ?? null,
          manufacturer: (c.manufacturer as string) ?? null,
          model: (c.model as string) ?? null,
          serialNumber: (c.serialNumber as string) ?? null,
          assetType: (c.assetType as string) ?? null,
          site: (c.site as string) ?? null,
          area: (c.area as string) ?? null,
          line: (c.line as string) ?? null,
          cell: (c.cell as string) ?? null,
          parentAssetId: (c.parentAssetId as string) ?? null,
          assetLevel: (c.assetLevel as string) ?? null,
        } as never,
        user.email
      );
      assetId = created.id;
    } else {
      return NextResponse.json(
        { error: "bad_request", message: "Provide assetId or createAsset." },
        { status: 400 }
      );
    }

    const pm = await assignProgramAsset(user.orgId, pmId, assetId, user.email);
    if (!pm) return NextResponse.json({ error: "not_found", message: "PM not found." }, { status: 404 });

    const detail = await getProgram(user.orgId, pmId);
    return NextResponse.json({ ok: true, pm: detail, assetId });
  } catch (err) {
    console.error("POST /api/pm/[id]/assign failed", err);
    const msg = err instanceof Error ? err.message : "Failed to assign asset.";
    const status = msg.includes("not found in org") ? 404 : 500;
    return NextResponse.json({ error: "internal", message: msg }, { status });
  }
});
