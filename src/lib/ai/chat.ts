import { COPILOT_SYSTEM_PROMPT } from "./systemPrompt";
import { buildDemoAnswer } from "./demo";
import { hybridRetrieve, type Citation, type RetrievalDiagnostics } from "@/lib/rag/hybrid";
import { buildFailureLookupContext } from "./failureLookup";
import type { RetrievedChunk } from "@/lib/rag/retrieve";
import { DEMO_ORG } from "@/lib/util";
import {
  getLiveChatProvider,
  getFallbackChatProvider,
  recordProviderError,
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
} from "./providers";

// Stream a LIVE provider, but if it throws BEFORE emitting any token, record the
// error and transparently stream the deterministic answer instead — so a live
// outage degrades gracefully and the failure is surfaced (never silent).
async function* liveWithFallback(
  provider: ChatProvider,
  req: ChatRequest,
  precomputed: string
): AsyncGenerator<string> {
  let emitted = false;
  try {
    for await (const delta of provider.stream(req)) {
      emitted = true;
      yield delta;
    }
    recordProviderError(null); // success → clear any prior error
  } catch (err) {
    const msg = (err as Error).message || "live provider error";
    recordProviderError(msg);
    if (!emitted) {
      // Nothing streamed yet — fall back cleanly to the deterministic answer.
      for (const chunk of precomputed.match(/[\s\S]{1,120}/g) ?? []) yield chunk;
    } else {
      yield `\n\n_(Live AI response interrupted: ${msg}. Showing what was generated.)_`;
    }
  }
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ImageAttachment {
  mediaType: string; // image/png, image/jpeg...
  dataBase64: string;
  filename?: string;
}

export interface StreamOpts {
  orgId: string; // tenant scope for retrieval — REQUIRED
  question: string;
  history?: ChatTurn[];
  assetId?: string | null;
  assetContext?: string; // pre-built asset profile summary
  images?: ImageAttachment[];
  /** Injected grounded failure records resolved from the question (internal). */
  failureContext?: string;
}

export interface StreamResult {
  stream: AsyncGenerator<string>;
  sources: RetrievedChunk[];
  citations: Citation[];
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  diagnostics: RetrievalDiagnostics;
  live: boolean;
  provider: string;
  model: string;
}

export async function streamAnswer(opts: StreamOpts): Promise<StreamResult> {
  if (!opts.orgId) throw new Error("streamAnswer() requires opts.orgId");

  // Hybrid retrieval: lexical + vector fusion, rerank, citations, confidence,
  // diagnostics — all tenant-scoped (+ global OEM knowledge).
  const retrieval = await hybridRetrieve(opts.question, {
    orgId: opts.orgId,
    assetId: opts.assetId ?? null,
    limit: 6,
  });
  const sources = retrieval.chunks;

  // Deterministic failure lookup: resolve the question to the org's OWN failure
  // records by asset number, part number, and/or affected area, and inject them
  // as authoritative grounding. Non-fatal: a failure here must never break chat.
  let failureContext = "";
  try {
    const fl = await buildFailureLookupContext(opts.orgId, opts.question, {
      selectedAssetId: opts.assetId ?? null,
    });
    failureContext = fl.context;
  } catch (err) {
    console.error("[chat] failure lookup skipped:", (err as Error).message);
  }
  const optsWithFailure: StreamOpts = { ...opts, failureContext };

  const liveProvider = getLiveChatProvider();

  // Always compute the deterministic expert answer — it is both the fallback
  // when no live key is set AND the safety net if a live call fails mid-flight.
  // Canned machine-specific demo cases are allowed ONLY in the isolated demo
  // tenant; a real customer org gets the honest expert/grounded answer.
  const precomputed = buildDemoAnswer(opts.question, sources, failureContext, opts.orgId === DEMO_ORG);

  let stream: AsyncGenerator<string>;
  let providerMeta: { provider: string; model: string };
  let live = Boolean(liveProvider);

  if (liveProvider) {
    const req = buildChatRequest(optsWithFailure, retrieval.citations);
    // Wrap the live stream: if it errors BEFORE producing output, record the
    // error (surfaced in /api/health.lastProviderError) and fall back to the
    // deterministic answer rather than failing the request silently.
    stream = liveWithFallback(liveProvider, req, precomputed);
    providerMeta = { provider: liveProvider.meta.provider, model: liveProvider.meta.model };
  } else {
    const fb = getFallbackChatProvider(precomputed);
    stream = fb.stream(buildChatRequest(optsWithFailure, retrieval.citations));
    providerMeta = { provider: fb.meta.provider, model: fb.meta.model };
    live = false;
  }

  return {
    stream,
    sources,
    citations: retrieval.citations,
    confidence: retrieval.confidence,
    confidenceLabel: retrieval.confidenceLabel,
    diagnostics: retrieval.diagnostics,
    live,
    provider: providerMeta.provider,
    model: providerMeta.model,
  };
}

// Non-streaming variant for the public API and server-side tasks.
export async function answerOnce(opts: StreamOpts): Promise<{
  answer: string;
  sources: RetrievedChunk[];
  citations: Citation[];
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  diagnostics: RetrievalDiagnostics;
  live: boolean;
  provider: string;
  model: string;
}> {
  const r = await streamAnswer(opts);
  let answer = "";
  for await (const delta of r.stream) answer += delta;
  return {
    answer,
    sources: r.sources,
    citations: r.citations,
    confidence: r.confidence,
    confidenceLabel: r.confidenceLabel,
    diagnostics: r.diagnostics,
    live: r.live,
    provider: r.provider,
    model: r.model,
  };
}

// Build the context block with NUMBERED markers that match the citations, so the
// model can cite inline with [1], [2] that map to structured Citation rows.
function buildContextBlock(opts: StreamOpts, citations: Citation[]): string {
  const parts: string[] = [];
  if (opts.failureContext) {
    parts.push(`PLANT FAILURE RECORDS (authoritative):\n${opts.failureContext}`);
  }
  if (opts.assetContext) {
    parts.push(`ASSET PROFILE:\n${opts.assetContext}`);
  }
  if (citations.length) {
    const ctx = citations
      .map(
        (c) =>
          `[${c.marker}] ${c.filename} (${c.kind}), excerpt ${c.excerpt}:\n${c.snippet}`
      )
      .join("\n\n---\n\n");
    parts.push(`RETRIEVED PLANT DOCUMENTS (cite inline with the bracket numbers):\n${ctx}`);
  }
  return parts.join("\n\n========\n\n");
}

function buildChatRequest(opts: StreamOpts, citations: Citation[]) {
  const context = buildContextBlock(opts, citations);
  const messages: ChatMessage[] = [];
  for (const t of opts.history ?? []) {
    messages.push({ role: t.role, content: t.content });
  }
  const prefix = context
    ? `Use the following plant-specific context where relevant.\n\n${context}\n\n========\n\nTECHNICIAN QUESTION:\n`
    : "";
  messages.push({
    role: "user",
    content: prefix + opts.question,
    images: opts.images?.map((i) => ({
      mediaType: i.mediaType,
      dataBase64: i.dataBase64,
      filename: i.filename,
    })),
  });
  return {
    system: COPILOT_SYSTEM_PROMPT,
    messages,
    maxTokens: 2400,
    temperature: 0.2,
  };
}
