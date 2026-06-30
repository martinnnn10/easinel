"use client";

import { useRef, useState, useCallback } from "react";
import type { ImagePayload } from "@/lib/useChatStream";

type UploadState = "indexing" | "indexed" | "warn" | "failed";

interface Attachment {
  filename: string;
  kind: string;
  indexing: boolean;
  state?: UploadState;
  note?: string;
  image?: ImagePayload;
}

export function Composer({
  onSend,
  busy,
  assetId,
  placeholder = "Describe the problem, paste a fault code, or ask anything…",
}: {
  onSend: (text: string, images: ImagePayload[]) => void;
  busy: boolean;
  assetId?: string | null;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      const arr = Array.from(files);

      // Optimistic chips
      setAttachments((prev) => [
        ...prev,
        ...arr.map((f) => ({
          filename: f.name,
          kind: guessKind(f),
          indexing: true,
        })),
      ]);

      // Read images to base64 for vision
      const imagePayloads = new Map<string, ImagePayload>();
      await Promise.all(
        arr
          .filter((f) => f.type.startsWith("image/"))
          .map(
            (f) =>
              new Promise<void>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const result = reader.result as string;
                  const base64 = result.split(",")[1] ?? "";
                  imagePayloads.set(f.name, {
                    mediaType: f.type,
                    dataBase64: base64,
                    filename: f.name,
                  });
                  resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsDataURL(f);
              })
          )
      );

      // Upload for indexing — and READ the response so we can be honest about
      // whether each file's content was actually extracted and indexed.
      const form = new FormData();
      if (assetId) form.append("assetId", assetId);
      arr.forEach((f) => form.append("files", f));
      const statusByName = new Map<string, { state: UploadState; note?: string }>();
      try {
        const resp = await fetch("/api/upload", { method: "POST", body: form });
        const data = await resp.json().catch(() => null);
        const results: UploadFileResult[] = data?.results ?? [];
        for (const r of results) {
          statusByName.set(r.filename, mapResultToState(r));
        }
      } catch {
        for (const f of arr) statusByName.set(f.name, { state: "failed", note: "Upload failed — check your connection and try again." });
      }

      setAttachments((prev) =>
        prev.map((a) => {
          if (!(arr.some((f) => f.name === a.filename) && a.indexing)) return a;
          const s = statusByName.get(a.filename);
          return {
            ...a,
            indexing: false,
            state: s?.state ?? "indexed",
            note: s?.note,
            image: imagePayloads.get(a.filename),
          };
        })
      );
    },
    [assetId]
  );

  const submit = useCallback(() => {
    if (!text.trim() || busy) return;
    const images = attachments
      .map((a) => a.image)
      .filter((x): x is ImagePayload => Boolean(x));
    onSend(text.trim(), images);
    setText("");
    setAttachments([]);
    if (taRef.current) taRef.current.style.height = "auto";
  }, [text, busy, attachments, onSend]);

  return (
    <div
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl shadow-black/30 focus-within:border-[var(--color-accent)]/60 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {attachments.map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 text-[11px] rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1 text-[var(--color-muted)]"
            >
              <DocIcon className="w-3 h-3 text-[var(--color-accent)]" />
              <span className="max-w-[160px] truncate">{a.filename}</span>
              <span className="text-[var(--color-faint)]">{statusText(a)}</span>
              {a.indexing ? (
                <span title="Reading file…" className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)] animate-pulse" />
              ) : (
                <span title={a.note ?? ""} className={`w-1.5 h-1.5 rounded-full ${dotColor(a.state)}`} />
              )}
            </span>
          ))}
        </div>
      )}

      {attachments.some((a) => !a.indexing && a.note) && (
        <div className="px-3 pt-1.5 space-y-1">
          {attachments
            .filter((a) => !a.indexing && a.note)
            .map((a, i) => (
              <p
                key={i}
                className={`text-[11px] leading-snug ${
                  a.state === "failed"
                    ? "text-[var(--color-red)]"
                    : "text-[var(--color-muted)]"
                }`}
              >
                <span className="font-medium text-[var(--color-text)]">{a.filename}:</span> {a.note}
              </p>
            ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-2.5">
        <button
          onClick={() => fileRef.current?.click()}
          title="Upload schematic, PLC export, manual, photo, alarm/vibration log…"
          className="shrink-0 w-9 h-9 grid place-items-center rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ClipIcon className="w-5 h-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent outline-none text-[14px] leading-6 py-2 text-[var(--color-text)] placeholder:text-[var(--color-faint)] max-h-[200px]"
        />

        <button
          onClick={submit}
          disabled={!text.trim() || busy}
          className="shrink-0 w-9 h-9 grid place-items-center rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all"
        >
          {busy ? (
            <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          ) : (
            <ArrowIcon className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}

interface UploadFileResult {
  filename: string;
  ok?: boolean;
  indexed?: boolean;
  status?: string;
  message?: string;
  chunkCount?: number;
  isSchematic?: boolean;
  schematicConfirmation?: string;
}

function mapResultToState(r: UploadFileResult): { state: UploadState; note?: string } {
  // For schematics/drawings, prefer the explicit schematic confirmation message
  // so the user gets an unambiguous "loaded / searchable or not" answer.
  const note = (r.isSchematic && r.schematicConfirmation) || r.message;
  if (r.ok && r.indexed) return { state: "indexed", note };
  if (r.status === "image") return { state: r.isSchematic ? "warn" : "indexed", note };
  if (r.status === "plc") return { state: r.indexed ? "indexed" : "warn", note };
  if (r.status === "error" || r.ok === false) {
    return { state: "failed", note: note ?? "This file could not be read." };
  }
  // empty / unsupported / binary_unsupported
  return { state: "warn", note: note ?? "Stored, but no readable text was found in this file." };
}

function statusText(a: Attachment): string {
  if (a.indexing) return "reading…";
  if (a.state === "failed") return "not read";
  if (a.state === "warn") return "not indexed";
  return a.kind;
}

function dotColor(state?: UploadState): string {
  if (state === "failed") return "bg-[var(--color-red)]";
  if (state === "warn") return "bg-[var(--color-amber)]";
  return "bg-[var(--color-green)]";
}

function guessKind(f: File): string {
  const n = f.name.toLowerCase();
  if (f.type.startsWith("image/")) return "photo";
  if (/\.(l5x|l5k|acd|scl|awl)$/.test(n)) return "plc";
  if (/schematic|wiring|electrical|drawing/.test(n)) return "drawing";
  if (/alarm|fault/.test(n)) return "alarm";
  if (/vibration|fft/.test(n)) return "vibration";
  if (/manual|guide/.test(n)) return "manual";
  if (/\.pdf$/.test(n)) return "document";
  return "document";
}

function ClipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
