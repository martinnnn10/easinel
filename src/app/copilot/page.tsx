import { Copilot } from "@/components/Copilot";
import { TopBar } from "@/components/TopBar";
import { getCurrentUser } from "@/lib/auth/session";
import { getAsset } from "@/lib/assets/repository";

// The app's Copilot screen. Lives at /copilot — the root route (/) is the
// public marketing site; the logged-in experience starts at /today.
//
// Deep-link grounding: /copilot?asset=<id>&ask=<question> lands a technician on
// an answer scoped to that machine's memory (drawings, history, PLC). The
// backend grounds automatically the moment a non-null assetId reaches the chat
// POST body — passing assetId here is the only wiring needed. The name is
// resolved server-side (a single org-scoped row) so the "Grounded to <machine>"
// label renders immediately and we skip a heavy client-side twin fetch.
export default async function CopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string | string[] }>;
}) {
  const sp = await searchParams;
  const assetId = typeof sp.asset === "string" && sp.asset.trim() ? sp.asset : undefined;

  let assetName: string | undefined;
  if (assetId) {
    const user = await getCurrentUser();
    if (user) {
      // Strictly org-scoped: a foreign/unknown id resolves to undefined (the
      // label falls back to "this machine"); grounding is fenced independently.
      const a = await getAsset(user.orgId, assetId).catch(() => null);
      assetName = a?.name;
    }
  }

  return (
    <>
      <TopBar
        title="Copilot"
        subtitle="Ask about a fault, a machine, or a procedure — answers cite your manuals and repair history"
      />
      <div className="flex-1 min-h-0">
        <Copilot assetId={assetId} assetName={assetName} />
      </div>
    </>
  );
}
