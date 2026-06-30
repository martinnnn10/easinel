import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { linkAsset } from "@/lib/parts/repository";

export const runtime = "nodejs";

// POST /api/parts/:id/asset-links  { assetId, position? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.assetId) {
    return NextResponse.json({ error: "bad_request", message: "assetId is required." }, { status: 400 });
  }
  await linkAsset(gate.user.orgId, id, body.assetId, body.position ?? null, gate.user.email);
  return NextResponse.json({ ok: true }, { status: 201 });
}
