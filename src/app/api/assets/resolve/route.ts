import { NextRequest, NextResponse } from "next/server";
import { resolveAssetForGeneration } from "@/lib/assets/assign";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Resolve a machine identity (model / serial / free text) to a probable EXISTING
// asset plus a prefilled NEW-asset draft and suggested number. Read-only.
export const POST = safeHandler("assets.resolve", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate empty body */
  }
  try {
    const result = await resolveAssetForGeneration(gate.user.orgId, {
      manufacturer: (body.manufacturer as string) ?? null,
      model: (body.model as string) ?? null,
      serialNumber: (body.serialNumber as string) ?? null,
      text: (body.text as string) ?? null,
      assetType: (body.assetType as string) ?? null,
      name: (body.name as string) ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/assets/resolve failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to resolve asset." }, { status: 500 });
  }
});
