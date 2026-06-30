import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { addAlias, listAliases } from "@/lib/parts/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("parts.aliases.list", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const aliases = await listAliases(gate.user.orgId, id);
  return NextResponse.json({ aliases });
});

// POST /api/parts/:id/aliases — add an alternate identifier / cross-reference.
export const POST = safeHandler("parts.aliases.add", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.alias?.trim()) {
    return NextResponse.json({ error: "bad_request", message: "alias is required." }, { status: 400 });
  }
  const alias = await addAlias(gate.user.orgId, id, body.alias, body.kind ?? "alt_pn", gate.user.email);
  if (!alias) {
    return NextResponse.json({ error: "not_found", message: "Part not found." }, { status: 404 });
  }
  return NextResponse.json({ alias }, { status: 201 });
});
