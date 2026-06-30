import type { ChatProvider, ChatRequest, ProviderMeta } from "./types";

// OpenAI-compatible Chat Completions provider. Works with the OpenAI API and any
// compatible gateway (Azure OpenAI, vLLM, Together, OpenRouter, the sandbox
// OPENAI_API_BASE, etc.). Streaming via SSE; no SDK dependency so it stays light.

const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

interface OAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export class OpenAIChatProvider implements ChatProvider {
  readonly meta: ProviderMeta = {
    provider: "openai",
    model: MODEL,
    live: true,
    vision: true,
  };
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async *stream(req: ChatRequest): AsyncGenerator<string> {
    const messages: Array<{ role: string; content: string | OAIContentPart[] }> = [
      { role: "system", content: req.system },
    ];
    for (const m of req.messages) {
      if (m.images && m.images.length) {
        const parts: OAIContentPart[] = m.images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mediaType};base64,${img.dataBase64}` },
        }));
        parts.push({ type: "text", text: m.content });
        messages.push({ role: m.role, content: parts });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: req.maxTokens ?? 2400,
        temperature: req.temperature ?? 0.2,
        stream: true,
        messages,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Chat API ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          // ignore keep-alive / partial frames
        }
      }
    }
  }
}
