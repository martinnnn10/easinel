import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { listDue } from "@/lib/pm/repository";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/pm/due — List all PMs that are due or overdue for the org
export const GET = safeHandler("pm.due", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const due = await listDue(gate.user.orgId);
  return NextResponse.json({ due });
});
