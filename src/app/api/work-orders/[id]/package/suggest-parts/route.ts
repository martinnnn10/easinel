import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";
import { getLiveChatProvider } from "@/lib/ai/providers";

export const runtime = "nodejs";

// Collect all chunks from a stream into a single string.
async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  let result = "";
  for await (const chunk of gen) {
    result += chunk;
  }
  return result;
}

// POST /api/work-orders/[id]/package/suggest-parts — AI suggests parts for the work package
export const POST = safeHandler("workpackage.suggest-parts", async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id: woId } = await params;

  // Get the WO
  const [wo] = await db
    .select()
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.id, woId), eq(schema.workOrders.orgId, user.orgId)));

  if (!wo) {
    return NextResponse.json({ error: "not_found", message: "Work order not found" }, { status: 404 });
  }

  // Get asset info
  let assetInfo = "";
  if (wo.assetId) {
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, wo.assetId), eq(schema.assets.orgId, user.orgId)));
    if (asset) {
      assetInfo = `Asset: ${asset.name}, Manufacturer: ${asset.manufacturer || "unknown"}, Model: ${asset.model || "unknown"}`;
    }
  }

  const provider = getLiveChatProvider();
  if (!provider) {
    return NextResponse.json({
      suggestedParts: [
        { description: "Replacement component (check OEM manual for exact part number)", qty: 1, confidence: "low" },
      ],
      note: "AI provider not configured — generic suggestion only.",
    });
  }

  const systemPrompt = `You are an industrial maintenance parts planner. Given a work order, suggest the most likely parts needed for the repair. Return ONLY a JSON array. Each element: { "description": string, "qty": number, "partNumber": string|null, "confidence": "high"|"medium"|"low", "reasoning": string }`;

  const userMsg = `Work Order: ${wo.title}
Symptom: ${wo.symptom || "Not specified"}
${assetInfo}
${wo.rootCause ? `Root Cause: ${wo.rootCause}` : ""}
${wo.failedPart ? `Failed Part: ${wo.failedPart}` : ""}

Suggest the parts needed for this repair.`;

  try {
    const text = await collectStream(
      provider.stream({ system: systemPrompt, messages: [{ role: "user", content: userMsg }], maxTokens: 1024, temperature: 0.3 })
    );
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parts = JSON.parse(jsonMatch[0]);
      return NextResponse.json({ suggestedParts: parts });
    }
    return NextResponse.json({ suggestedParts: [], note: "AI could not determine parts" });
  } catch (err) {
    return NextResponse.json({
      suggestedParts: [],
      note: "AI suggestion failed — planner should manually specify parts",
      error: String(err),
    });
  }
});
