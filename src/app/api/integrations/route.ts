import { NextRequest, NextResponse } from "next/server";
import {
  catalog,
  listIntegrations,
  connectIntegration,
  disconnectIntegration,
  syncIntegration,
  pushPmToConnector,
} from "@/lib/integrations/service";
import { hasLiveAdapter } from "@/lib/integrations/adapter";
import { demoModeEnabled } from "@/lib/util";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("integrations.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const connected = await listIntegrations(gate.user.orgId);
  // `live` reflects a GENUINELY operable integration (registered adapter + live
  // credential) — never just the presence of an env var. `demo` lets the isolated
  // demo workspace exercise the sandbox round-trip; a real org shows the honest
  // "available for pilot" CTA for anything not truly live.
  const cat = catalog().map((c) => ({ ...c, live: hasLiveAdapter(c.key) }));
  return NextResponse.json({ catalog: cat, connected, demo: demoModeEnabled() });
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
    // Never echo the raw internal/provider error to the browser. Log it
    // server-side; return a generic message.
    console.error("[integrations.post] action failed:", (err as Error).message);
    return NextResponse.json(
      { error: "integration_error", message: "Something went wrong with that integration action. Please try again." },
      { status: 500 }
    );
  }
});
