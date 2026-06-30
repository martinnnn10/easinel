import type { ChatProvider, ChatRequest, ProviderMeta } from "./types";

// Deterministic fallback provider. Produces a real, structured answer with NO
// API key by delegating to the curated maintenance answer engine. It keeps the
// product fully demonstrable offline and guarantees the UI/API contract is
// identical whether or not a live LLM is configured.
//
// The actual answer text is computed by the caller (it has the retrieved
// sources and question); this provider just streams the precomputed string so
// every consumer uses ONE streaming code path.

export class FallbackChatProvider implements ChatProvider {
  readonly meta: ProviderMeta = {
    provider: "deterministic-fallback",
    model: "eas-grounded-v1",
    live: false,
    vision: false,
  };

  private precomputed: string;

  constructor(precomputed: string) {
    this.precomputed = precomputed;
  }

  async *stream(_req: ChatRequest): AsyncGenerator<string> {
    const tokens = this.precomputed.match(/\s+|\S+/g) ?? [this.precomputed];
    for (const tok of tokens) {
      yield tok;
      await new Promise((r) => setTimeout(r, 6));
    }
  }
}
