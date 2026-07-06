"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChatStream, type ChatMessage } from "@/lib/useChatStream";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { speak, stopSpeaking, speechSupported } from "@/lib/voice";

// Generic capability prompts that map to the shared OEM knowledge — NOT fake
// customer machines. Nothing here implies a specific asset exists in the
// workspace (production must never show canned scenarios like "Conveyor 3").
const SUGGESTIONS = [
  "What should I check first for a VFD overload that trips after warm-up?",
  "A PowerFlex drive shows Fault F081 — what does it mean and what do I check?",
  "How do I diagnose a motor that keeps tripping its overload?",
  "Why would a photoeye intermittently miss parts?",
  "Generate a PM for a gearbox.",
  "Write an RCA for a repeat motor failure.",
];

export function Copilot({
  assetId,
  assetName,
  seed,
  conversationId,
}: {
  assetId?: string | null;
  assetName?: string;
  seed?: ChatMessage[];
  conversationId?: string;
}) {
  const { messages, busy, send, reset } = useChatStream(assetId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  const loadSession = useCallback(
    async (sid: string) => {
      try {
        const d = await fetch(`/api/conversations/${sid}`).then((r) => r.json());
        const seedMsgs: ChatMessage[] = (d.messages ?? []).map(
          (m: { id: string; role: string; content: string; meta?: string }) => {
            let meta: Record<string, unknown> = {};
            try {
              meta = m.meta ? JSON.parse(m.meta) : {};
            } catch {
              /* ignore */
            }
            return {
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              sources: meta.sources as ChatMessage["sources"],
              citations: meta.citations as ChatMessage["citations"],
              confidence: meta.confidence as number | undefined,
              confidenceLabel: meta.confidenceLabel as string | undefined,
              provider: meta.provider as string | undefined,
              model: meta.model as string | undefined,
              diagnostics: meta.diagnostics as ChatMessage["diagnostics"],
              live: meta.live as boolean | undefined,
            };
          }
        );
        if (seedMsgs.length) reset(seedMsgs, sid);
      } catch {
        /* ignore */
      }
    },
    [reset]
  );

  useEffect(() => {
    if (!seeded.current && seed && seed.length) {
      reset(seed, conversationId);
      seeded.current = true;
    }
  }, [seed, conversationId, reset]);

  // Resume a troubleshooting session linked via ?c=<id> (/copilot only).
  useEffect(() => {
    if (assetId || seed) return;
    const sid = new URLSearchParams(window.location.search).get("c");
    if (sid && !seeded.current) {
      seeded.current = true;
      loadSession(sid);
    }
  }, [assetId, seed, loadSession]);

  // Auto-ask a starter question linked via ?ask=<question> — the onboarding deep
  // link so a brand-new org lands a real, cited grounded answer on click #1
  // (the seeded OEM knowledge answers common faults with zero uploads).
  useEffect(() => {
    if (seed) return;
    const q = new URLSearchParams(window.location.search).get("ask");
    if (q && !seeded.current) {
      seeded.current = true;
      send(q, []);
    }
  }, [seed, send]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className={`${empty && !assetName ? "max-w-5xl" : "max-w-3xl"} mx-auto px-4 md:px-6 py-6`}>
          {empty ? (
            <CommandCenter
              assetName={assetName}
              onPick={(t) => send(t, [])}
              onResume={loadSession}
            />
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  assetId={assetId}
                  prevUser={
                    m.role === "assistant" && i > 0 ? messages[i - 1]?.content : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] bg-gradient-to-t from-[var(--color-bg)] to-transparent">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-4">
          <Composer
            onSend={send}
            busy={busy}
            assetId={assetId}
            placeholder={
              assetName
                ? `Ask about ${assetName} — its history, drawings, and PLC are in context…`
                : "Describe the problem, paste a fault code, or upload a document…"
            }
          />
          <p className="text-center text-[11px] text-[var(--color-faint)] mt-2">
            Verify critical steps against OEM specs and your site&apos;s safety procedures.
          </p>
        </div>
      </div>
    </div>
  );
}

interface HomeData {
  assets: { id: string; name: string; manufacturer?: string | null; model?: string | null }[];
  documents: { id: string; filename: string; kind: string }[];
  sessions: { id: string; title: string; assetName: string | null; messageCount: number; updatedAt: number }[];
  counts: { assets: number; documents: number; sessions: number; openWorkOrders: number };
}

const kindIcon: Record<string, string> = {
  manual: "📘", drawing: "📐", plc: "🧩", photo: "📷",
  alarm: "🚨", vibration: "📊", sop: "📋", lesson: "🧠", document: "📄",
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// The global home is the command center: a focused, Copilot-first screen.
function CommandCenter({
  assetName,
  onPick,
  onResume,
}: {
  assetName?: string;
  onPick: (t: string) => void;
  onResume: (id: string) => void;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    if (assetName) return;
    fetch("/api/home")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoaded(true));
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const n = d?.user?.name;
        if (n && n !== "Owner") setName(n.split(" ")[0]);
      })
      .catch(() => {});
  }, [assetName]);

  // Asset-scoped hero stays simple.
  if (assetName) {
    return (
      <div className="fadeup pt-4 md:pt-8">
        <div className="flex items-center gap-2 text-[var(--color-accent)] text-[13px] font-medium mb-3">
          <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
          {`Asset Copilot · ${assetName}`}
        </div>
        <h1 className="text-2xl md:text-[30px] font-semibold tracking-tight leading-tight">
          {`What's going on with ${assetName}?`}
        </h1>
        <p className="text-[var(--color-muted)] mt-2 text-[15px] max-w-2xl">
          This machine's manuals, drawings, PLC exports, work orders, and lessons
          learned are in context. Describe the fault and I'll reason over its
          history before answering.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mt-6">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <SuggestionButton key={s} text={s} onPick={onPick} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fadeup pt-6 md:pt-12">
      {/* Greeting + the single most important question */}
      <div className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-1.5 text-[var(--color-faint)] text-[10px] font-medium mb-3 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
          Grounded in your plant&apos;s documents
        </div>
        <h1 className="text-2xl md:text-[32px] font-semibold tracking-tight leading-tight">
          {greeting()}{name ? `, ${name}` : ""}.
        </h1>
        <p className="text-[var(--color-muted)] mt-2 text-[16px] md:text-[17px]">
          What maintenance problem are you solving today?
        </p>
      </div>

      {/* Prompt starters — large, central, the product's center of gravity */}
      <div className="mt-7 grid sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
        {SUGGESTIONS.map((s) => (
          <SuggestionButton key={s} text={s} onPick={onPick} />
        ))}
      </div>

      {/* Upload tiles */}
      <div className="mt-8 max-w-2xl mx-auto">
        <p className="text-[11px] uppercase tracking-wider text-[var(--color-faint)] mb-2 text-center">
          Or upload documents to ground the Copilot
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <UploadTile icon="" label="Manual" />
          <UploadTile icon="" label="PLC Program" />
          <UploadTile icon="" label="Drawing" />
          <UploadTile icon="" label="Alarm History" />
        </div>
      </div>

      {/* Recent assets + recent sessions — pick up where you left off */}
      <div className="grid lg:grid-cols-2 gap-4 mt-9 max-w-3xl mx-auto">
        <RecentPanel title="Recent assets" href="/assets" empty="No equipment yet — uploads and questions build each machine's memory." loaded={loaded}>
          {data?.assets.map((a) => (
            <Link key={a.id} href={`/assets/${a.id}`} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--color-surface-2)] transition">
              <span className="w-6 h-6 grid place-items-center rounded bg-[var(--color-surface-2)] text-[11px] text-[var(--color-faint)]">A</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] truncate">{a.name}</span>
                <span className="block text-[10px] text-[var(--color-faint)] truncate">
                  {[a.manufacturer, a.model].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              <span className="text-[var(--color-faint)] text-xs">→</span>
            </Link>
          ))}
        </RecentPanel>

        <RecentPanel title="Recent troubleshooting sessions" href="/sessions" empty="Ask your first question — each diagnosis is saved as searchable history." loaded={loaded}>
          {data?.sessions.slice(0, 6).map((s) => (
            <button
              key={s.id}
              onClick={() => onResume(s.id)}
              className="w-full text-left flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--color-surface-2)] transition"
            >
              <span className="w-6 h-6 grid place-items-center rounded bg-[var(--color-surface-2)] text-[11px] text-[var(--color-faint)]">S</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] truncate">{s.title}</span>
                <span className="block text-[10px] text-[var(--color-faint)] truncate">
                  {s.assetName ? `${s.assetName} · ` : ""}{s.messageCount} messages
                </span>
              </span>
              <span className="text-[var(--color-faint)] text-xs">→</span>
            </button>
          ))}
        </RecentPanel>
      </div>
    </div>
  );
}

function SuggestionButton({ text, onPick }: { text: string; onPick: (t: string) => void }) {
  return (
    <button
      onClick={() => onPick(text)}
      className="group text-left text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-2)] transition-all flex items-center gap-2"
    >
      <span className="text-[var(--color-faint)] group-hover:text-[var(--color-accent)]">→</span>
      {text}
    </button>
  );
}

// An upload tile that posts straight into the ingest pipeline. The chosen label
// hints the document kind; the backend still classifies by filename/extension.
function UploadTile({ icon: _icon, label }: { icon: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();
  return (
    <label
      className={`relative flex items-center justify-center text-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 cursor-pointer hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-2)] transition ${
        busy ? "opacity-60 pointer-events-none" : ""
      }`}
    >
      <span className="text-[12px] font-medium text-[var(--color-muted)]">
        {busy ? "Indexing…" : done ? "✓ Added" : label}
      </span>
      <input
        type="file"
        multiple
        hidden
        onChange={async (e) => {
          if (!e.target.files?.length) return;
          setBusy(true);
          const form = new FormData();
          Array.from(e.target.files).forEach((f) => form.append("files", f));
          try {
            await fetch("/api/upload", { method: "POST", body: form });
            setDone(true);
            setTimeout(() => router.push("/knowledge"), 700);
          } catch {
            /* ignore */
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

function RecentPanel({
  title,
  href,
  empty,
  loaded,
  children,
}: {
  title: string;
  href: string;
  empty: string;
  loaded: boolean;
  children?: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{title}</h3>
        <Link href={href} className="text-[11px] text-[var(--color-accent)] hover:underline">View all</Link>
      </div>
      {!loaded ? (
        <div className="space-y-1.5 px-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          ))}
        </div>
      ) : hasChildren ? (
        <div className="space-y-0.5">{children}</div>
      ) : (
        <p className="text-[12px] text-[var(--color-faint)] px-2 py-3 leading-relaxed">{empty}</p>
      )}
    </div>
  );
}

function MessageBubble({
  m,
  assetId,
  prevUser,
}: {
  m: ChatMessage;
  assetId?: string | null;
  prevUser?: string;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end fadeup">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 fadeup">
      <div className="shrink-0 w-7 h-7 rounded-md bg-[var(--color-accent-soft)] border border-[var(--color-border)] grid place-items-center text-[var(--color-accent)] text-[12px] font-bold mt-0.5">
        E
      </div>
      <div className="min-w-0 flex-1">
        {m.content ? (
          <Markdown>{m.content}</Markdown>
        ) : (
          <div className="flex items-center gap-1.5 text-[var(--color-muted)] text-[13px] py-1">
            <Dot /> <Dot d={0.15} /> <Dot d={0.3} />
            <span className="ml-1">Diagnosing…</span>
          </div>
        )}
        {m.streaming && m.content && <span className="blink" />}

        {!m.streaming && (m.sources?.length || m.citations?.length || m.live !== undefined) && (
          <AnswerMeta m={m} />
        )}

        {!m.streaming && m.content && prevUser && (
          <AnswerActions question={prevUser} body={m.content} assetId={assetId} />
        )}
      </div>
    </div>
  );
}

// ── Enterprise answer metadata: provenance a VP of Maintenance can trust ──
// Surfaces the real generation provider/model, a calibrated confidence badge,
// numbered citations that map to the inline [n] markers in the answer, and an
// optional retrieval-diagnostics panel for technical reviewers / auditors.
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI-compatible",
  fallback: "Deterministic fallback",
  "deterministic-fallback": "Deterministic fallback",
};

function confidenceStyle(label?: string): string {
  switch ((label || "").toLowerCase()) {
    case "high":
      return "border-[var(--color-green)]/40 text-[var(--color-green)] bg-[var(--color-green)]/5";
    case "medium":
      return "border-[var(--color-amber)]/40 text-[var(--color-amber)] bg-[var(--color-amber)]/5";
    default:
      return "border-[var(--color-red)]/40 text-[var(--color-red)] bg-[var(--color-red)]/5";
  }
}

function AnswerMeta({ m }: { m: ChatMessage }) {
  const [showDiag, setShowDiag] = useState(false);
  const providerName = PROVIDER_LABEL[m.provider ?? ""] ?? (m.live ? "Live model" : "Grounded engine");
  const pct =
    typeof m.confidence === "number" ? Math.round(m.confidence * 100) : undefined;
  const citations = m.citations?.length
    ? m.citations
    : (m.sources ?? []).map((s, i) => ({ marker: i + 1, filename: s.filename, kind: s.kind, excerpt: undefined as string | undefined }));
  const d = m.diagnostics;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Generation provenance — truthful about live vs. grounded engine */}
        <span
          className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
            m.live
              ? "border-[var(--color-green)]/40 text-[var(--color-green)] bg-[var(--color-green)]/5"
              : "border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-surface)]"
          }`}
          title={m.model ? `Model: ${m.model}` : undefined}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${m.live ? "bg-[var(--color-green)]" : "bg-[var(--color-faint)]"}`} />
          {providerName}{m.live && m.model ? ` · ${m.model}` : ""}
        </span>

        {/* Confidence badge — calibrated from retrieval, not hardcoded */}
        {m.confidenceLabel && (
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${confidenceStyle(m.confidenceLabel)}`}
            title="Confidence is derived from retrieval coverage, score margin, semantic match, and source agreement."
          >
            {m.confidenceLabel} confidence{pct !== undefined ? ` · ${pct}%` : ""}
          </span>
        )}

        {/* Grounding source badge — plant docs vs general knowledge */}
        {citations.length > 0 ? (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-[var(--color-accent)]/30 text-[var(--color-accent)] bg-[var(--color-accent)]/5">
            Grounded in plant docs
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-faint)] bg-[var(--color-surface)]">
            General knowledge
          </span>
        )}
      </div>

      {/* Numbered citations mapping to inline [n] markers */}
      {citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-faint)]">Sources</span>
          {citations.map((c) => (
            <span
              key={c.marker}
              title={c.excerpt || c.filename}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-text)] transition"
            >
              <span className="grid place-items-center w-3.5 h-3.5 rounded-full bg-[var(--color-surface-2)] text-[9px] font-semibold text-[var(--color-accent)]">
                {c.marker}
              </span>
              {c.filename}
            </span>
          ))}
        </div>
      )}

      {/* Retrieval diagnostics — collapsible, for reviewers and audits */}
      {d && (
        <div>
          <button
            onClick={() => setShowDiag((v) => !v)}
            className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-muted)] inline-flex items-center gap-1 transition"
          >
            <span className={`transition-transform ${showDiag ? "rotate-90" : ""}`}>›</span>
            Retrieval diagnostics
          </button>
          {showDiag && (
            <div className="mt-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] text-[var(--color-muted)] grid grid-cols-2 gap-x-4 gap-y-1">
              {d.fusion && <Diag k="Fusion" v={String(d.fusion)} />}
              {d.reranker && <Diag k="Reranker" v={String(d.reranker)} />}
              {typeof d.lexicalCandidates === "number" && <Diag k="Lexical hits" v={String(d.lexicalCandidates)} />}
              {typeof d.vectorCandidates === "number" && <Diag k="Vector hits" v={String(d.vectorCandidates)} />}
              {typeof d.returned === "number" && <Diag k="Returned" v={String(d.returned)} />}
              {typeof d.semanticEmbeddings === "boolean" && <Diag k="Embeddings" v={d.semanticEmbeddings ? "semantic" : "lexical fallback"} />}
              {typeof d.latencyMs === "number" && <Diag k="Latency" v={`${d.latencyMs} ms`} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Diag({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--color-faint)]">{k}</span>
      <span className="font-mono text-[var(--color-text)]">{v}</span>
    </div>
  );
}

// The two actions that turn a diagnosis into work + organizational memory.
function AnswerActions({
  question,
  body,
  assetId,
}: {
  question: string;
  body: string;
  assetId?: string | null;
}) {
  const [wo, setWo] = useState<"idle" | "saving" | "done">("idle");
  const [woNumber, setWoNumber] = useState("");
  const [lesson, setLesson] = useState<"idle" | "saving" | "done">("idle");
  const [speaking, setSpeaking] = useState(false);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {speechSupported() && (
        <button
          onClick={() => {
            if (speaking) { stopSpeaking(); setSpeaking(false); }
            else { speak(body); setSpeaking(true); }
          }}
          aria-label={speaking ? "Stop reading" : "Read answer aloud"}
          className="inline-flex items-center gap-1.5 text-[12px] rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] transition"
        >
          {speaking ? "⏹ Stop" : "🔊 Read aloud"}
        </button>
      )}
      <button
        disabled={wo !== "idle"}
        onClick={async () => {
          setWo("saving");
          try {
            const res = await fetch("/api/work-orders", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: question.slice(0, 90),
                description: body,
                assetId: assetId ?? null,
                source: "copilot",
                priority: "high",
              }),
            });
            const d = await res.json();
            setWoNumber(d.workOrder?.number ?? "");
            setWo("done");
          } catch {
            setWo("idle");
          }
        }}
        className="inline-flex items-center gap-1.5 text-[12px] rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] disabled:opacity-70 transition"
      >
        {wo === "idle" && "🛠️ Create Work Order"}
        {wo === "saving" && "Creating…"}
        {wo === "done" && `✓ Created ${woNumber}`}
      </button>

      <button
        disabled={lesson !== "idle"}
        onClick={async () => {
          setLesson("saving");
          try {
            await fetch("/api/lessons", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                title: question.slice(0, 90),
                problem: question,
                resolution: body,
                assetId: assetId ?? null,
              }),
            });
            setLesson("done");
          } catch {
            setLesson("idle");
          }
        }}
        className="inline-flex items-center gap-1.5 text-[12px] rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] disabled:opacity-70 transition"
      >
        {lesson === "idle" && "🧠 Save as Lesson Learned"}
        {lesson === "saving" && "Saving…"}
        {lesson === "done" && "✓ Saved to memory"}
      </button>
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
      style={{ animation: `pulse-dot 1s ease-in-out ${d}s infinite` }}
    />
  );
}
