import { NextRequest, NextResponse } from "next/server";
import {
  getAssetDigitalTwin,
  updateAsset,
  deleteAsset,
} from "@/lib/assets/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Full digital twin: asset + photos + documents + lessons + PLC projects +
// work orders + alarm history + sessions + computed reliability metrics.
export const GET = safeHandler("assets.get", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  try {
    const twin = await getAssetDigitalTwin(gate.user.orgId, id);
    if (!twin) {
      return NextResponse.json({ error: "not_found", message: "Asset not found." }, { status: 404 });
    }
    return NextResponse.json(twin);
  } catch (err) {
    console.error("GET /api/assets/[id] failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to load asset." }, { status: 500 });
  }
});

// Update asset. technician+ (manage_assets).
export const PATCH = safeHandler("assets.update", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_assets");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const asset = await updateAsset(user.orgId, id, body as never, user.email);
    if (!asset) {
      return NextResponse.json({ error: "not_found", message: "Asset not found." }, { status: 404 });
    }
    return NextResponse.json({ asset });
  } catch (err) {
    console.error("PATCH /api/assets/[id] failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to update asset." }, { status: 500 });
  }
});

// Delete asset. admin+ (delete_assets).
export const DELETE = safeHandler("assets.delete", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("delete_assets");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await params;
  try {
    const ok = await deleteAsset(user.orgId, id, user.email);
    if (!ok) {
      return NextResponse.json({ error: "not_found", message: "Asset not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/assets/[id] failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to delete asset." }, { status: 500 });
  }
});
