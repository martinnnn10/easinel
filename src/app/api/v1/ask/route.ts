import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/apiAuth";
import { answerOnce } from "@/lib/ai/chat";
import { buildAssetContext } from "@/lib/queries";
import { emitEvent } from "@/lib/events";
import { checkRateLimit, rateLimitHeaders, RATE_RULES } from "@/lib/security/rateLimit";
import { apiError } from "@/lib/api/respond";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/v1/ask — the Copilot as an API. Any CMMS/EAM/ERP/portal can embed
// EAS troubleshooting intelligence with one authenticated call.
export const POST = withApiKey(async (req: NextRequest, orgId: string) => {
  // Per-tenant throttle so one customer's integration can't exhaust shared
  // capacity (and to bound spend on the upstream model).
  const rl = checkRateLimit("public_api:ask", orgId, RATE_RULES.publicApi());
  if (!rl.ok) {
    return apiError("rate_limited", {
      status: 429,
      message: "Rate limit exceeded for this API key. Retry after the reset window.",
      headers: rateLimitHeaders(rl),
    });
  }

  const body = await req.json().catch(() => ({}));
  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json(
      { error: "bad_request", message: "`question` is required." },
      { status: 400 }
    );
  }
  const assetContext = body.assetId ? await buildAssetContext(orgId, body.assetId) : undefined;
  const { answer, citations, confidence, confidenceLabel, diagnostics, live, provider, model } =
    await answerOnce({
      orgId,
      question,
      assetId: body.assetId ?? null,
      assetContext,
    });
  await emitEvent(orgId, "copilot.answered", { question, assetId: body.assetId ?? null, live });
  // `include=diagnostics` opts into the full retrieval trace; default keeps the
  // payload lean for production integrations.
  const includeDiag = req.nextUrl.searchParams.get("include") === "diagnostics";
  return NextResponse.json({
    answer,
    mode: live ? "live" : "grounded-fallback",
    model: `${provider}:${model}`,
    confidence,
    confidenceLabel,
    citations: citations.map((c) => ({
      marker: c.marker,
      filename: c.filename,
      kind: c.kind,
      excerpt: c.excerpt,
      relevance: c.relevance,
      snippet: c.snippet,
    })),
    ...(includeDiag ? { diagnostics } : {}),
  });
});
