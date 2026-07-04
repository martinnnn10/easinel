// Model tiering for cost control. Don't spend Opus on every question:
//   • Known fault-code / simple lookups  → deterministic engine (NO LLM spend)
//   • Normal technician troubleshooting   → Sonnet
//   • Complex engineering / PLC / RCA / multi-document reasoning → Opus
//
// The deterministic decision is made by the caller (expert fault-code layer); this
// module chooses between Sonnet and Opus for the LIVE path and knows model prices
// so usage can be costed and capped.

export type ModelTier = "deterministic" | "sonnet" | "opus";

export function opusModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
}
export function sonnetModel(): string {
  return process.env.AI_MODEL_SONNET || "claude-sonnet-4-5";
}

// Estimated prices in USD per 1,000,000 tokens (input, output). Configurable via
// env so they can be corrected without a deploy. Defaults are order-of-magnitude
// Anthropic list prices and are used only for soft cost reporting/caps.
function priceFor(model: string): { inPerM: number; outPerM: number } {
  const isOpus = /opus/i.test(model);
  const inPerM = Number(process.env[isOpus ? "AI_PRICE_OPUS_IN" : "AI_PRICE_SONNET_IN"]) ||
    (isOpus ? 15 : 3);
  const outPerM = Number(process.env[isOpus ? "AI_PRICE_OPUS_OUT" : "AI_PRICE_SONNET_OUT"]) ||
    (isOpus ? 75 : 15);
  return { inPerM, outPerM };
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  if (!/opus|sonnet/i.test(model)) return 0; // deterministic / fallback = free
  const { inPerM, outPerM } = priceFor(model);
  return (promptTokens / 1_000_000) * inPerM + (completionTokens / 1_000_000) * outPerM;
}

// Cheap, provider-agnostic token estimate (~4 chars/token). Exact provider usage
// can replace this later; this is accurate enough for soft caps and reporting.
export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

const COMPLEX = /\b(plc|ladder|rung|routine|\.l5x|l5x|studio\s*5000|rslogix|controllogix|compactlogix|tag\s|aoi|udt|rca|root cause|5[-\s]?why|fishbone|failure analysis|reliability|design|calculate|siz(e|ing)|commission|integrat|network topology|profinet|ethernet\/ip|trace|analyz)\b/i;

// A question is "complex" if it needs real reasoning (PLC/RCA/engineering) or is
// long. Used so a known fault code that's embedded in a complex ask (e.g. "trace
// the ladder for F007 and do an RCA") is NOT short-circuited to the one-line
// deterministic lookup — it goes to the live model instead.
export function looksComplex(question: string): boolean {
  return COMPLEX.test(question) || (question || "").length > 600;
}

export interface ModelChoiceInput {
  question: string;
  contextChars: number; // total retrieved-context size
  contextSources: number; // number of distinct sources/chunks
  hasImages: boolean;
  historyTurns: number;
}

// Choose Sonnet vs Opus for a LIVE call. Opus only when the question is genuinely
// complex (engineering/PLC/RCA), spans multiple documents, includes images, or is
// a deep multi-turn thread. Everything else uses Sonnet.
export function selectLiveModel(input: ModelChoiceInput): { tier: "sonnet" | "opus"; model: string } {
  // NOTE: source COUNT is not a complexity signal — retrieval always returns
  // several chunks. Genuine "multi-document reasoning" shows up as a large total
  // context size, which contextChars captures.
  const complex =
    COMPLEX.test(input.question) ||
    input.hasImages ||
    input.contextChars > 12000 ||
    input.historyTurns >= 4 ||
    input.question.length > 600;
  return complex ? { tier: "opus", model: opusModel() } : { tier: "sonnet", model: sonnetModel() };
}
