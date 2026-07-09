import { NextResponse } from "next/server";
import { listDocuments, listSessions } from "@/lib/queries";
import { listAssets } from "@/lib/assets/repository";
import { listWorkOrders, isOpenStatus } from "@/lib/workorders/repository";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Single call that powers the homepage command center — fewer round-trips, one
// loading state. Tenant-scoped: every aggregate is filtered to the caller's org.
export const GET = safeHandler("home.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const [assets, documents, sessions, workOrders] = await Promise.all([
    listAssets(orgId),
    listDocuments(orgId),
    listSessions(orgId, 6),
    listWorkOrders(orgId),
  ]);
  // Retired machines stay out of the working view — the same rule the Equipment
  // page uses. A retired "Test VFD" must never surface in the Copilot's Recent
  // Assets panel where a prospect would read it as leftover test data.
  const workingAssets = assets.filter((a) => a.status !== "retired");
  return NextResponse.json({
    assets: workingAssets.slice(0, 6),
    documents: documents.slice(0, 6),
    sessions,
    counts: {
      assets: workingAssets.length,
      documents: documents.length,
      sessions: sessions.length,
      openWorkOrders: workOrders.filter((w) => isOpenStatus(w.status)).length,
    },
  });
});
