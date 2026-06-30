import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { listParts, searchParts, createPart } from "@/lib/parts/repository";

export const runtime = "nodejs";

// GET /api/parts?q=<search>
export async function GET(req: NextRequest) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const parts = q ? await searchParts(orgId, q) : await listParts(orgId);
  return NextResponse.json({ parts, query: q ?? null });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body.description) {
    return NextResponse.json({ error: "description required" }, { status: 400 });
  }
  const part = await createPart(
    gate.user.orgId,
    {
      description: body.description,
      partNumber: body.partNumber ?? null,
      manufacturer: body.manufacturer ?? null,
      manufacturerPartNumber: body.manufacturerPartNumber ?? null,
      category: body.category ?? null,
    },
    gate.user.email
  );
  return NextResponse.json({ part }, { status: 201 });
}
