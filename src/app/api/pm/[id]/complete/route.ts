import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { recordCompletion } from "@/lib/pm/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/pm/:id/complete  { status?: "done"|"skipped", notes? }
export const POST = safeHandler("pm.complete", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("complete_pm");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  await recordCompletion(
    gate.user.orgId,
    id,
    { status: body.status === "skipped" ? "skipped" : "done", notes: body.notes ?? null, completedBy: gate.user.email },
    gate.user.email
  );
  return NextResponse.json({ ok: true });
});
