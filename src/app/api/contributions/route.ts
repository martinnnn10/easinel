import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { getContributions } from "@/lib/contributions/summary";

export const runtime = "nodejs";

// GET /api/contributions?days=90 — who is doing the real work, for recognition
// and traceability. Manager/admin/owner only (manage_workforce). Every credit is
// traced to a real user via the audit log; org-scoped.
export const GET = safeHandler("contributions.get", async (req: NextRequest) => {
  const gate = await requirePermission("manage_workforce");
  if (gate instanceof NextResponse) return gate;
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 90));
  const summary = await getContributions(gate.user.orgId, days);
  return NextResponse.json(summary);
});
