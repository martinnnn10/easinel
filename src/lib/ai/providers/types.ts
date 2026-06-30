// Vendor-neutral LLM chat provider abstraction.
//
// The application depends ONLY on the `ChatProvider` interface and the
// `getChatProvider()` factory — never on a concrete vendor SDK. Adding an API
// key activates a real provider with ZERO code changes; with no key the system
// degrades to a deterministic, fully-functional fallback. This is the contract
// that makes the AI layer "production-ready today, live the moment a key lands".

export interface ChatImage {
  mediaType: string; // image/png | image/jpeg | image/gif | image/webp
  dataBase64: string;
  filename?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: ChatImage[];
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderMeta {
  /** Stable provider id, e.g. "anthropic", "openai", "deterministic-fallback". */
  provider: string;
  /** Concrete model name actually used. */
  model: string;
  /** True when this provider produces genuine LLM output (vs. the fallback). */
  live: boolean;
  /** True when the provider can accept image inputs. */
  vision: boolean;
}

export interface ChatProvider {
  readonly meta: ProviderMeta;
  /**
   * Stream a completion as text deltas. Fallback providers may "stream" a
   * precomputed answer; that is intentional and keeps one code path for callers.
   */
  stream(req: ChatRequest): AsyncGenerator<string>;
}
