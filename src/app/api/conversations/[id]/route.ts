import { NextRequest, NextResponse } from "next/server";
import { listMessages } from "@/lib/queries";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const messages = await listMessages(gate.user.orgId, id);
  return NextResponse.json({ messages });
}
