import { NextRequest, NextResponse } from "next/server";
import {
  catalog,
  listIntegrations,
  connectIntegration,
  disconnectIntegration,
  syncIntegration,
  pushPmToConnector,
} from "@/lib/integrations/service";
import { isLiveConnector } from "@/lib/integrations/adapter";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("integrations.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const connected = await listIntegrations(gate.user.orgId);
  const cat = catalog().map((c) => ({ ...c, live: isLiveConnector(c.key) }));
  return NextResponse.json({ catalog: cat, connected });
});

export const POST = safeHandler("integrations.post", async (req: NextRequest) => {
  const gate = await requirePermission("manage_integrations");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const orgId = gate.user.orgId;
  const { action, connectorKey, config, pmProgramId } = body;
  if (!connectorKey) {
    return NextResponse.json({ error: "connectorKey required" }, { status: 400 });
  }
  try {
    if (action === "connect") {
      const result = await connectIntegration(orgId, connectorKey, config);
      return NextResponse.json(result);
    }
    if (action === "disconnect") {
      await disconnectIntegration(orgId, connectorKey);
      return NextResponse.json({ ok: true });
    }
    if (action === "sync") {
      const result = await syncIntegration(orgId, connectorKey);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "push_pm") {
      if (!pmProgramId) return NextResponse.json({ error: "pmProgramId required" }, { status: 400 });
      const result = await pushPmToConnector(orgId, connectorKey, pmProgramId);
      return NextResponse.json({ ok: result.pushed, ...result });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});
