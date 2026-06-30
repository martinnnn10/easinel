import { NextRequest, NextResponse } from "next/server";
import { addAlarmEvent, listAlarmEvents } from "@/lib/assets/repository";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id: assetId } = await params;
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 100) || 100);
  try {
    const alarms = await listAlarmEvents(gate.user.orgId, assetId, limit);
    return NextResponse.json({ alarms });
  } catch (err) {
    console.error("GET alarms failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to load alarms." }, { status: 500 });
  }
}

// Record an alarm/fault. technician+ (manage_assets).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("manage_assets");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id: assetId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "bad_request", message: "Message is required." }, { status: 400 });
  }
  try {
    const alarm = await addAlarmEvent(user.orgId, assetId, body as never, user.email);
    if (!alarm) {
      return NextResponse.json({ error: "not_found", message: "Asset not found." }, { status: 404 });
    }
    return NextResponse.json({ alarm }, { status: 201 });
  } catch (err) {
    console.error("POST alarms failed", err);
    return NextResponse.json({ error: "internal", message: "Failed to record alarm." }, { status: 500 });
  }
}
