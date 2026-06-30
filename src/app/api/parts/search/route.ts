import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { smartSearch } from "@/lib/parts/search";

export const runtime = "nodejs";

// GET /api/parts/search?q=... — AI-assisted, org-scoped, honest-confidence search.
export async function GET(req: NextRequest) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const result = await smartSearch(gate.user.orgId, q);
  return NextResponse.json({ result });
}
