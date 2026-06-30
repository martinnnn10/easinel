import { NextRequest } from "next/server";
import { streamAnswer, type ChatTurn, type ImageAttachment } from "@/lib/ai/chat";
import {
  getOrCreateConversation,
  addMessage,
  buildAssetContext,
} from "@/lib/queries";
import { requirePermission } from "@/lib/auth/guard";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ChatBody {
  question: string;
  conversationId?: string | null;
  assetId?: string | null;
  history?: ChatTurn[];
  images?: ImageAttachment[];
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("ask_copilot");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const body = (await req.json()) as ChatBody;
  const question = (body.question ?? "").trim();
  if (!question) {
    return new Response(JSON.stringify({ error: "Empty question" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const assetContext = body.assetId
    ? await buildAssetContext(orgId, body.assetId)
    : undefined;

  const {
    stream,
    sources,
    citations,
    confidence,
    confidenceLabel,
    diagnostics,
    live,
    provider,
    model,
  } = await streamAnswer({
    orgId,
    question,
    history: body.history ?? [],
    assetId: body.assetId ?? null,
    assetContext,
    images: body.images ?? [],
  });

  const conversationId = await getOrCreateConversation(
    orgId,
    body.conversationId,
    body.assetId ?? null,
    question
  );
  await addMessage(orgId, conversationId, "user", question);

  const encoder = new TextEncoder();
  let assembled = "";

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // First line is a JSON metadata header (sources, mode, conversationId),
      // followed by a form-feed separator, then the streamed markdown body.
      const header = JSON.stringify({
        conversationId,
        live,
        provider,
        model,
        confidence,
        confidenceLabel,
        citations,
        diagnostics,
        sources: sources.map((s) => ({
          filename: s.filename,
          kind: s.kind,
          ordinal: s.ordinal,
        })),
      });
      controller.enqueue(encoder.encode(header + "\f"));

      try {
        for await (const delta of stream) {
          assembled += delta;
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        const msg = `\n\n> ⚠️ Error generating response: ${(err as Error).message}`;
        assembled += msg;
        controller.enqueue(encoder.encode(msg));
      } finally {
        await addMessage(orgId, conversationId, "assistant", assembled, {
          live,
          provider,
          model,
          confidence,
          confidenceLabel,
          citations,
          diagnostics,
          sources: sources.map((s) => ({ filename: s.filename, kind: s.kind })),
        });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-conversation-id": conversationId,
    },
  });
}
