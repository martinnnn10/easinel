import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { listAuditLog } from "@/lib/audit/query";

export const runtime = "nodejs";

// GET /api/audit — the org's activity/audit trail for compliance & traceability.
// Manager+ (manage_workforce). Supports ?target= (per-record history),
// ?actor=, ?category=, ?days=, ?limit=. Strictly org-scoped.
export const GET = safeHandler("audit.get", async (req: NextRequest) => {
  const gate = await requirePermission("manage_workforce");
  if (gate instanceof NextResponse) return gate;
  const sp = req.nextUrl.searchParams;
  const entries = await listAuditLog(gate.user.orgId, {
    target: sp.get("target") || undefined,
    actor: sp.get("actor") || undefined,
    category: sp.get("category") || undefined,
    sinceDays: sp.get("days") ? Number(sp.get("days")) : undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ entries });
});
