import { COPILOT_SYSTEM_PROMPT } from "./systemPrompt";
import { buildDemoAnswer } from "./demo";
import { buildFaultCodeAnswer } from "./expert";
import { selectLiveModel, estimateTokens, looksComplex } from "./model";
import { recordAiUsage, recordLiveSuccess } from "./usage";
import { aiEntitlement } from "@/lib/billing/entitlements";
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
    recordLiveSuccess(); // stamp last successful live answer (health/admin)
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
  userId?: string | null; // for per-user AI usage attribution
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
  mode: "live" | "fallback" | "deterministic";
  /** When live was skipped by cost controls, why (quota / kill switch). */
  blockedReason?: string | null;
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
  const precomputed = buildDemoAnswer(opts.question, sources, failureContext, opts.orgId === DEMO_ORG);

  // COST CONTROL #1 — SIMPLE known fault-code questions are answered
  // deterministically from the OEM tables, with NO LLM spend, even when a live
  // key is set. A fault code embedded in a COMPLEX ask (ladder trace / RCA) is
  // NOT short-circuited — it goes to the live model for real reasoning.
  const isFaultCodeAnswerable =
    Boolean(buildFaultCodeAnswer(opts.question, sources)) && !looksComplex(opts.question);

  // Central entitlement — live AI requires active billing + AI quota + kill
  // switch (past_due/canceled/expired-trial → deterministic fallback).
  const decision = liveProvider ? await aiEntitlement(opts.orgId) : { allowed: false, reason: null };

  const useLive = Boolean(liveProvider) && !isFaultCodeAnswerable && decision.allowed;

  let stream: AsyncGenerator<string>;
  let providerMeta: { provider: string; model: string };
  let mode: "live" | "fallback" | "deterministic";

  if (useLive && liveProvider) {
    // COST CONTROL #2/#3 — Sonnet for normal troubleshooting, Opus only for
    // complex engineering / PLC / RCA / multi-document / image reasoning.
    const contextChars = sources.reduce((n, c) => n + c.content.length, 0);
    const { model } = selectLiveModel({
      question: opts.question,
      contextChars,
      contextSources: sources.length,
      hasImages: Boolean(opts.images?.length),
      historyTurns: opts.history?.length ?? 0,
    });
    const req = { ...buildChatRequest(optsWithFailure, retrieval.citations), model };
    stream = liveWithFallback(liveProvider, req, precomputed);
    providerMeta = { provider: liveProvider.meta.provider, model };
    mode = "live";
  } else {
    const fb = getFallbackChatProvider(precomputed);
    stream = fb.stream(buildChatRequest(optsWithFailure, retrieval.citations));
    providerMeta = { provider: fb.meta.provider, model: fb.meta.model };
    mode = isFaultCodeAnswerable ? "deterministic" : "fallback";
  }

  // COST CONTROL #5 — record usage (per org/user/route/model/mode) on completion.
  const promptTokens = estimateTokens(
    COPILOT_SYSTEM_PROMPT + buildContextBlock(optsWithFailure, retrieval.citations) + opts.question
  );
  stream = withUsageRecording(stream, {
    orgId: opts.orgId,
    userId: opts.userId ?? null,
    route: "chat",
    model: providerMeta.model,
    mode,
    promptTokens,
  });

  return {
    stream,
    sources,
    citations: retrieval.citations,
    confidence: retrieval.confidence,
    confidenceLabel: retrieval.confidenceLabel,
    diagnostics: retrieval.diagnostics,
    live: mode === "live",
    provider: providerMeta.provider,
    model: providerMeta.model,
    mode,
    blockedReason: liveProvider && !decision.allowed && !isFaultCodeAnswerable ? decision.reason : null,
  };
}

// Record AI usage when the answer stream finishes (estimated completion tokens
// from the streamed text). Fire-and-forget so it never blocks or breaks a reply.
async function* withUsageRecording(
  inner: AsyncGenerator<string>,
  meta: { orgId: string; userId: string | null; route: string; model: string; mode: "live" | "fallback" | "deterministic"; promptTokens: number }
): AsyncGenerator<string> {
  let out = "";
  try {
    for await (const delta of inner) {
      out += delta;
      yield delta;
    }
  } finally {
    recordAiUsage({
      orgId: meta.orgId,
      userId: meta.userId,
      route: meta.route,
      model: meta.model,
      mode: meta.mode,
      promptTokens: meta.promptTokens,
      completionTokens: estimateTokens(out),
    }).catch(() => {});
  }
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
