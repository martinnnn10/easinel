import { NextRequest, NextResponse } from "next/server";
import { generateRca } from "@/lib/rca/generate";
import { saveRca } from "@/lib/rca/save";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

// POST /api/work-orders/:id/rca — generate an RCA from this closed work order.
// Body { save: true } also indexes it into Knowledge (kind="rca"). Org-scoped.
export const POST = safeHandler("workorders.rca", async (req: NextRequest, ctx: Ctx) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const rca = await generateRca(gate.user.orgId, id);
  if (!rca) return NextResponse.json({ error: "not_found", message: "Work order not found." }, { status: 404 });

  const body = await req.json().catch(() => ({} as { save?: boolean }));
  let saved: { documentId: string } | undefined;
  if (body?.save) {
    const s = await saveRca(gate.user.orgId, rca, gate.user.id);
    saved = { documentId: s.documentId };
  }
  return NextResponse.json({ rca, saved });
});
