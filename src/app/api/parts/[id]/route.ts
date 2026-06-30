import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { getPart, updatePart } from "@/lib/parts/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/parts/:id — single part (org-scoped).
export const GET = safeHandler("parts.get", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const part = await getPart(gate.user.orgId, id);
  if (!part) {
    return NextResponse.json({ error: "not_found", message: "Part not found." }, { status: 404 });
  }
  return NextResponse.json({ part });
});

// PATCH /api/parts/:id — edit catalog + Field Memory + sourcing fields.
export const PATCH = safeHandler("parts.update", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const updated = await updatePart(gate.user.orgId, id, body, gate.user.email);
  if (!updated) {
    return NextResponse.json({ error: "not_found", message: "Part not found." }, { status: 404 });
  }
  return NextResponse.json({ part: updated });
});
