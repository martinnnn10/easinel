import { NextRequest, NextResponse } from "next/server";
import { networkIntelligence } from "@/lib/moat/network";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/network?manufacturer=&model=&assetType=&faultCode=
// Anonymized cross-plant OEM intelligence. This deliberately queries the POOLED
// signal set (the moat), but the aggregation layer enforces consent-only pooling
// + k-anonymity and returns ONLY counts/percentages/medians — never any tenant
// identifier — so it exposes no customer data. Still auth-gated.
export const GET = safeHandler("network.intelligence", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const sp = req.nextUrl.searchParams;
  const result = await networkIntelligence({
    manufacturer: sp.get("manufacturer"),
    model: sp.get("model"),
    assetType: sp.get("assetType"),
    faultCode: sp.get("faultCode"),
  });
  return NextResponse.json({ network: result });
});
