import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { getReuseImpact } from "@/lib/reuse/impact";

export const runtime = "nodejs";

// GET /api/impact?days=90 — Knowledge Reuse Impact for managers/admins. Shows
// whether captured knowledge was reused and, only when real history supports it,
// the downtime it helped avoid. Manager+ (manage_workforce); org-scoped.
export const GET = safeHandler("impact.get", async (req: NextRequest) => {
  const gate = await requirePermission("manage_workforce");
  if (gate instanceof NextResponse) return gate;
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 90));
  const summary = await getReuseImpact(gate.user.orgId, days);
  return NextResponse.json(summary);
});
