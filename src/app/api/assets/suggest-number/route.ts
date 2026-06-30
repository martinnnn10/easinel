import { NextRequest, NextResponse } from "next/server";
import { suggestAssetNumber } from "@/lib/assets/assign";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

// Suggest an editable, collision-safe asset number (SITE-LINE-MACHINE-###).
// Read-only proposal; the user can override before saving.
export async function GET(req: NextRequest) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const sp = req.nextUrl.searchParams;
  try {
    const result = await suggestAssetNumber(gate.user.orgId, {
      site: sp.get("site"),
      area: sp.get("area"),
      line: sp.get("line"),
      assetType: sp.get("assetType"),
      name: sp.get("name"),
      model: sp.get("model"),
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/assets/suggest-number failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to suggest asset number." }, { status: 500 });
  }
}
