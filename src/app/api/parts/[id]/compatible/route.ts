import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { findCompatible } from "@/lib/parts/search";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/parts/:id/compatible — honest compatible replacements from the org's
// own catalog (same category + manufacturer/cross-reference). Empty if none.
export const POST = safeHandler("parts.compatible", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const compatible = await findCompatible(gate.user.orgId, id);
  return NextResponse.json({ compatible });
});
