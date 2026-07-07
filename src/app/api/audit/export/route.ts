import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { listAuditLog, auditLogCsv } from "@/lib/audit/query";

export const runtime = "nodejs";

// GET /api/audit/export — the org's audit trail as a CSV download for auditors.
// Manager+ (manage_workforce); org-scoped; honors the same filters as /api/audit.
export const GET = safeHandler("audit.export", async (req: NextRequest) => {
  const gate = await requirePermission("manage_workforce");
  if (gate instanceof NextResponse) return gate;
  const sp = req.nextUrl.searchParams;
  const entries = await listAuditLog(gate.user.orgId, {
    target: sp.get("target") || undefined,
    actor: sp.get("actor") || undefined,
    category: sp.get("category") || undefined,
    sinceDays: sp.get("days") ? Number(sp.get("days")) : undefined,
    limit: 2000,
  });
  const csv = auditLogCsv(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="eas-audit-log-${stamp}.csv"`,
    },
  });
});
