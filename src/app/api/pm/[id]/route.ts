import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { getProgram, approveProgram, archiveProgram } from "@/lib/pm/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("pm.get", async (
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const program = await getProgram(gate.user.orgId, id);
  if (!program) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ program });
});

// PATCH /api/pm/:id  { action: "approve" | "archive" }
// Approval is the human-in-the-loop gate — AI can never reach "active" itself.
export const PATCH = safeHandler("pm.update", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.action === "approve") {
    const program = await approveProgram(gate.user.orgId, id, gate.user.email);
    if (!program) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ program });
  }
  if (body.action === "archive") {
    await archiveProgram(gate.user.orgId, id, gate.user.email);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
});
