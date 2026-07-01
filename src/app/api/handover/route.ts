import { NextRequest, NextResponse } from "next/server";
import { generateHandover } from "@/lib/handover/generate";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/handover?hours=12 — the end-of-shift digest for THIS org.
export const GET = safeHandler("handover.get", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const h = Number(req.nextUrl.searchParams.get("hours"));
  const windowHours = Number.isFinite(h) && h > 0 && h <= 168 ? h : 12;
  const digest = await generateHandover(gate.user.orgId, windowHours);
  return NextResponse.json({ digest });
});
