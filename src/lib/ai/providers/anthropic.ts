import Anthropic from "@anthropic-ai/sdk";
import type { ChatProvider, ChatRequest, ProviderMeta } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

export class AnthropicChatProvider implements ChatProvider {
  readonly meta: ProviderMeta = {
    provider: "anthropic",
    model: MODEL,
    live: true,
    vision: true,
  };
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *stream(req: ChatRequest): AsyncGenerator<string> {
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => {
      if (m.images && m.images.length) {
        const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
        for (const img of m.images) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: img.dataBase64,
            },
          });
        }
        content.push({ type: "text", text: m.content });
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });

    const streamed = await this.client.messages.stream({
      model: MODEL,
      max_tokens: req.maxTokens ?? 2400,
      temperature: req.temperature,
      system: req.system,
      messages,
    });

    for await (const event of streamed) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
