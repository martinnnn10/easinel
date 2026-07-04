import type { ChatProvider } from "./types";
import { AnthropicChatProvider } from "./anthropic";
import { OpenAIChatProvider } from "./openai";
import { FallbackChatProvider } from "./fallback";

export type { ChatProvider, ChatRequest, ChatMessage, ChatImage, ProviderMeta } from "./types";

// Provider selection priority (first configured wins):
//   1. ANTHROPIC_API_KEY  → Anthropic (Claude)
//   2. AI_CHAT_API_KEY / OPENAI_API_KEY → OpenAI-compatible
//   3. nothing            → deterministic fallback (needs precomputed text)
//
// Forcing the fallback for tests/offline demos: set AI_DISABLED=1.

export function hasLiveProvider(): boolean {
  if (process.env.AI_DISABLED === "1") return false;
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.AI_CHAT_API_KEY ||
      process.env.OPENAI_API_KEY
  );
}

export type ActiveProvider = "anthropic" | "openai-compatible" | "deterministic-fallback";

// The provider that WILL answer, given the current environment. Used by the
// health probe and the admin banner so a silent fallback is always visible.
// NOTE: an EMPTY string key (ANTHROPIC_API_KEY="") is falsy → treated as NOT
// configured, which is exactly the "empty key → fallback" case to surface.
export function activeProviderName(): ActiveProvider {
  if (process.env.AI_DISABLED === "1") return "deterministic-fallback";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.AI_CHAT_API_KEY || process.env.OPENAI_API_KEY) return "openai-compatible";
  return "deterministic-fallback";
}

export function activeProviderModel(): string | null {
  const p = activeProviderName();
  if (p === "anthropic") return process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  if (p === "openai-compatible") return process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  return null;
}

// Last error from a LIVE provider (so a fallback is never silent — it surfaces in
// /api/health as lastProviderError). Module-level, best-effort, reset on success.
const globalForAi = globalThis as unknown as { __lastProviderError?: string | null };
export function recordProviderError(msg: string | null): void {
  globalForAi.__lastProviderError = msg;
}
export function lastProviderError(): string | null {
  return globalForAi.__lastProviderError ?? null;
}

/**
 * Returns a LIVE chat provider if any key is configured, else null. The caller
 * decides how to build the fallback (it owns the precomputed answer text).
 */
export function getLiveChatProvider(): ChatProvider | null {
  if (process.env.AI_DISABLED === "1") return null;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) return new AnthropicChatProvider(anthropicKey);

  const openaiKey = process.env.AI_CHAT_API_KEY || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const baseUrl =
      process.env.AI_CHAT_API_BASE ||
      process.env.OPENAI_API_BASE ||
      "https://api.openai.com/v1";
    return new OpenAIChatProvider(openaiKey, baseUrl);
  }
  return null;
}

/** Build the deterministic fallback around a precomputed answer. */
export function getFallbackChatProvider(precomputed: string): ChatProvider {
  return new FallbackChatProvider(precomputed);
}
