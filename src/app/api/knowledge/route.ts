import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/queries";
import { listPlcProjects } from "@/lib/plc/store";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const assetId = req.nextUrl.searchParams.get("assetId") || undefined;
  const documents = await listDocuments(orgId, assetId);

  // Attach PLC project linkage so the Knowledge UI can deep-link a PLC
  // document straight into the PLC Explorer (otherwise the row is a dead click).
  let plcByDoc: Map<string, { id: string; fidelity: string }> = new Map();
  try {
    const projects = await listPlcProjects(orgId);
    plcByDoc = new Map(
      projects
        .filter((p) => p.documentId)
        .map((p) => [p.documentId as string, { id: p.id, fidelity: p.fidelity }])
    );
  } catch {
    // PLC store unavailable — degrade gracefully, documents still list.
  }

  const enriched = documents.map((d) => {
    const plc = plcByDoc.get(d.id);
    return plc
      ? { ...d, plcProjectId: plc.id, plcFidelity: plc.fidelity }
      : d;
  });

  return NextResponse.json({ documents: enriched });
}
