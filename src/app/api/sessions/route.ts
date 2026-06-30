import { NextResponse } from "next/server";
import { listSessions } from "@/lib/queries";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const sessions = await listSessions(gate.user.orgId, 100);
  return NextResponse.json({ sessions });
}
