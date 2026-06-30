"use client";

import { useCallback, useRef, useState } from "react";

export interface Source {
  filename: string;
  kind: string;
  ordinal: number;
}

export interface Citation {
  marker: number;
  filename: string;
  kind?: string;
  excerpt?: string;
  documentId?: string;
}

export interface RetrievalDiagnostics {
  fusion?: string;
  reranker?: string;
  lexicalCandidates?: number;
  vectorCandidates?: number;
  returned?: number;
  semanticEmbeddings?: boolean;
  latencyMs?: number;
  [k: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  citations?: Citation[];
  confidence?: number;
  confidenceLabel?: string;
  provider?: string;
  model?: string;
  diagnostics?: RetrievalDiagnostics;
  live?: boolean;
  streaming?: boolean;
}

export interface ImagePayload {
  mediaType: string;
  dataBase64: string;
  filename?: string;
}

let counter = 0;
const mkId = () => `m${Date.now()}_${counter++}`;

export function useChatStream(assetId?: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const convId = useRef<string | null>(null);

  const reset = useCallback((seed: ChatMessage[] = [], conversationId?: string) => {
    setMessages(seed);
    convId.current = conversationId ?? null;
  }, []);

  const send = useCallback(
    async (text: string, images: ImagePayload[] = []) => {
      if (!text.trim() || busy) return;
      setBusy(true);

      const userMsg: ChatMessage = { id: mkId(), role: "user", content: text };
      const aiMsg: ChatMessage = {
        id: mkId(),
        role: "assistant",
        content: "",
        streaming: true,
      };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg, aiMsg]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: text,
            conversationId: convId.current,
            assetId: assetId ?? null,
            history,
            images,
          }),
        });

        if (!res.body) throw new Error("No response stream");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let headerParsed = false;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          if (!headerParsed) {
            const ff = buffer.indexOf("\f");
            if (ff === -1) continue;
            const headerStr = buffer.slice(0, ff);
            buffer = buffer.slice(ff + 1);
            headerParsed = true;
            try {
              const header = JSON.parse(headerStr);
              convId.current = header.conversationId ?? convId.current;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsg.id
                    ? {
                        ...m,
                        sources: header.sources,
                        citations: header.citations,
                        confidence: header.confidence,
                        confidenceLabel: header.confidenceLabel,
                        provider: header.provider,
                        model: header.model,
                        diagnostics: header.diagnostics,
                        live: header.live,
                      }
                    : m
                )
              );
            } catch {
              /* ignore */
            }
          }

          const current = buffer;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsg.id ? { ...m, content: current } : m
            )
          );
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id ? { ...m, content: buffer, streaming: false } : m
          )
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? {
                  ...m,
                  streaming: false,
                  content:
                    m.content +
                    `\n\n> ⚠️ ${(err as Error).message || "Request failed"}`,
                }
              : m
          )
        );
      } finally {
        setBusy(false);
      }
    },
    [assetId, busy, messages]
  );

  return { messages, busy, send, reset, conversationId: convId };
}
