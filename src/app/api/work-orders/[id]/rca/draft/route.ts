import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { draftRca } from "@/lib/rca/draft";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/work-orders/:id/rca/draft — an AI-SUGGESTED RCA draft for review.
// Returns structured fields to prefill the form; it is NOT saved and NEVER sets
// a confirmed root cause. The client shows it labeled and the human edits/saves.
export const POST = safeHandler("workorders.rca.draft", async (_req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("update_work_order");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const draft = await draftRca(gate.user.orgId, id);
  if (!draft) return NextResponse.json({ error: "not_found", message: "Work order not found." }, { status: 404 });
  return NextResponse.json({ draft });
});
