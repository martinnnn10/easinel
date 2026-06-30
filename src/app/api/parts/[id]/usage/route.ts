import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { getFieldMemory } from "@/lib/parts/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/parts/:id/usage — the part's "Field Memory" (assets, failures, PMs).
export const GET = safeHandler("parts.usage", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const memory = await getFieldMemory(gate.user.orgId, id);
  if (!memory) {
    return NextResponse.json({ error: "not_found", message: "Part not found." }, { status: 404 });
  }
  return NextResponse.json({ memory });
});
