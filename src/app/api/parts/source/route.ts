import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { smartSearch } from "@/lib/parts/search";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/parts/source  { query }
// Sourcing entry point. It surfaces any INTERNAL matches (the org's own parts &
// suppliers) and is explicit that LIVE external supplier pricing/availability is
// not integrated — it never returns invented prices or stock numbers.
export const POST = safeHandler("parts.source", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const query = (body.query ?? "").trim();
  const search = query ? await smartSearch(gate.user.orgId, query) : null;
  return NextResponse.json({
    query,
    internalMatches: search?.matches ?? [],
    bestMatch: search?.bestMatch ?? null,
    liveSourcing: {
      available: false,
      message: "Supplier pricing and availability require integration.",
    },
  });
});
