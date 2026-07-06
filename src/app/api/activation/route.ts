import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { getActivationProgress } from "@/lib/onboarding/progress";

export const runtime = "nodejs";

// GET /api/activation — real setup-milestone progress for the Today checklist.
// Any member may read it; every flag is derived from actual org records.
export const GET = safeHandler("activation.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const progress = await getActivationProgress(gate.user.orgId);
  return NextResponse.json(progress);
});
