import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { addSupplier, listSuppliers } from "@/lib/parts/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("parts.suppliers.list", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const suppliers = await listSuppliers(gate.user.orgId, id);
  return NextResponse.json({ suppliers });
});

// POST /api/parts/:id/suppliers — record a supplier (name/link/notes only; no
// live pricing feed). Pricing/availability stay empty unless a human enters them.
export const POST = safeHandler("parts.suppliers.add", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "bad_request", message: "Supplier name is required." }, { status: 400 });
  }
  const supplier = await addSupplier(
    gate.user.orgId,
    id,
    { name: body.name, url: body.url ?? null, leadTime: body.leadTime ?? null, price: body.price ?? null, notes: body.notes ?? null },
    gate.user.email
  );
  if (!supplier) {
    return NextResponse.json({ error: "not_found", message: "Part not found." }, { status: 404 });
  }
  return NextResponse.json({ supplier }, { status: 201 });
});
