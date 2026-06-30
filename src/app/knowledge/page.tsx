"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";

interface Doc {
  id: string;
  filename: string;
  kind: string;
  charCount?: number;
  sizeBytes?: number;
  createdAt?: number;
  plcProjectId?: string;
  plcFidelity?: string;
}

const kindMeta: Record<string, { icon: string; label: string }> = {
  manual: { icon: "📘", label: "Manual" },
  drawing: { icon: "📐", label: "Drawing" },
  plc: { icon: "🧩", label: "PLC Program" },
  photo: { icon: "📷", label: "Photo" },
  alarm: { icon: "🚨", label: "Alarm Log" },
  vibration: { icon: "📊", label: "Vibration" },
  sop: { icon: "📋", label: "SOP / PM" },
  lesson: { icon: "🧠", label: "Lesson Learned" },
  document: { icon: "📄", label: "Document" },
};

export default function KnowledgePage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  // When an ACD (summary-only) is uploaded we surface the export-L5X guide
  // immediately instead of dropping the user into a sparse Explorer.
  const [acdGuide, setAcdGuide] = useState<{ id: string; filename: string } | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/knowledge")
        .then((r) => r.json())
        .then((d) => setDocs(d.documents ?? []))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setLoading(true);
    await load();

    // PLC files: a full-fidelity L5X opens straight into the rich Explorer; an
    // ACD (summary only) pops the export-to-L5X guide first so the user knows
    // exactly how to get full ladder logic — never a silent dead end.
    const plcResult = json?.results?.find(
      (r: { plcProjectId?: string }) => r?.plcProjectId
    );
    if (plcResult?.plcProjectId) {
      if (plcResult.plcFidelity === "full") {
        router.push(`/plc/${plcResult.plcProjectId}`);
      } else {
        setAcdGuide({ id: plcResult.plcProjectId, filename: plcResult.filename });
      }
    }
  };

  const openDoc = (d: Doc) => {
    if (!d.plcProjectId) return;
    // Full L5X → straight into the Explorer. ACD (summary) → show the same
    // export-to-L5X guide as on upload, so a click is never a dead end.
    if (d.plcFidelity === "full") {
      router.push(`/plc/${d.plcProjectId}`);
    } else {
      setAcdGuide({ id: d.plcProjectId, filename: d.filename });
    }
  };

  const kinds = ["all", ...Array.from(new Set(docs.map((d) => d.kind)))];
  const shown = filter === "all" ? docs : docs.filter((d) => d.kind === filter);
  const indexedCount = docs.filter((d) => (d.charCount ?? 0) > 0).length;

  return (
    <>
      <TopBar
        title="Knowledge Base"
        subtitle={`${docs.length} documents · ${indexedCount} indexed for retrieval`}
        right={
          <label
            className={`text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 cursor-pointer hover:brightness-110 ${
              busy ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            {busy ? "Indexing…" : "+ Upload"}
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => upload(e.target.files)}
            />
          </label>
        }
      />

      <div
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(e.dataTransfer.files);
        }}
      >
        <div className="max-w-5xl mx-auto px-5 py-6">
          <div className="flex gap-1.5 flex-wrap mb-5">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`text-[12px] px-3 py-1 rounded-full border transition ${
                  filter === k
                    ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-accent)]/10"
                    : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {k === "all" ? "All" : kindMeta[k]?.label ?? k}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
              <p className="text-[15px] font-medium">
                Drop files here to build your industrial knowledge base
              </p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">
                Manuals, SOPs, electrical / hydraulic / pneumatic drawings, PLC
                backups (.L5X / .ACD), PMs, and failure reports are auto-indexed
                and searched on every Copilot question.
              </p>
            </div>
          ) : (
            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
              {shown.map((d, i) => {
                const meta = kindMeta[d.kind] ?? kindMeta.document;
                const isPlc = !!d.plcProjectId;
                return (
                  <div
                    key={d.id}
                    role={isPlc ? "button" : undefined}
                    tabIndex={isPlc ? 0 : undefined}
                    onClick={() => openDoc(d)}
                    onKeyDown={(e) => {
                      if (isPlc && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        openDoc(d);
                      }
                    }}
                    className={`flex items-center gap-3 px-4 py-3 transition ${
                      i > 0 ? "border-t border-[var(--color-border-soft)]" : ""
                    } ${
                      isPlc
                        ? "cursor-pointer hover:bg-[var(--color-accent)]/[0.06]"
                        : "hover:bg-[var(--color-surface-2)]"
                    }`}
                  >
                    <span className="text-lg">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate">
                        {d.filename}
                      </p>
                      <p className="text-[11px] text-[var(--color-faint)]">
                        {meta.label}
                        {d.charCount
                          ? ` · ${d.charCount.toLocaleString()} chars indexed`
                          : " · stored (not text-indexed)"}
                        {isPlc && d.plcFidelity
                          ? ` · ${
                              d.plcFidelity === "full"
                                ? "full structure"
                                : "summary only"
                            }`
                          : ""}
                      </p>
                    </div>

                    {isPlc && (
                      <span className="text-[11px] font-medium text-[var(--color-accent)] whitespace-nowrap">
                        Open in PLC Explorer →
                      </span>
                    )}

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        (d.charCount ?? 0) > 0
                          ? "text-[var(--color-green)] bg-[var(--color-green)]/10"
                          : "text-[var(--color-faint)] bg-[var(--color-surface-2)]"
                      }`}
                    >
                      {(d.charCount ?? 0) > 0 ? "Indexed" : "Stored"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {acdGuide && (
        <AcdGuideModal
          filename={acdGuide.filename}
          onOpenSummary={() => router.push(`/plc/${acdGuide.id}`)}
          onClose={() => setAcdGuide(null)}
        />
      )}
    </>
  );
}

// Shown right after an .ACD upload. .ACD is a compressed Rockwell binary — full
// ladder logic isn't recoverable from it — so we tell the user exactly how to
// get the rich Explorer (export L5X) rather than leaving them on a sparse page.
function AcdGuideModal({
  filename,
  onOpenSummary,
  onClose,
}: {
  filename: string;
  onOpenSummary: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <span className="text-xl">🧩</span>
          <h2 className="font-semibold text-[15px]">Uploaded — but export L5X for full logic</h2>
        </div>
        <p className="text-[12.5px] text-[var(--color-muted)] leading-relaxed">
          <span className="text-[var(--color-text)] font-mono text-[11.5px]">{filename}</span> is a
          compressed Rockwell <strong className="text-[var(--color-text)]">.ACD</strong> binary.
          Ladder logic, tags, and rung comments aren’t stored in readable form, so EAS can only
          show a summary of it. To unlock the full Explorer (programs, routines, rungs, tags,
          cross-references):
        </p>
        <ol className="mt-3 space-y-1.5 text-[12.5px] text-[var(--color-text)]">
          <li className="flex gap-2"><span className="text-[var(--color-accent)] font-semibold">1.</span> Open the project in <strong>Studio 5000</strong> (or RSLogix 5000).</li>
          <li className="flex gap-2"><span className="text-[var(--color-accent)] font-semibold">2.</span> <strong>File → Save As</strong>, then set “Save as type” to <strong>L5X (XML)</strong>.</li>
          <li className="flex gap-2"><span className="text-[var(--color-accent)] font-semibold">3.</span> Upload that <strong>.L5X</strong> here — it opens straight into the full Explorer.</li>
        </ol>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button
            onClick={onOpenSummary}
            className="text-[13px] px-3 py-2 sm:py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
          >
            Open summary anyway
          </button>
          <button
            onClick={onClose}
            className="text-[13px] font-medium px-4 py-2 sm:py-1.5 rounded-lg bg-[var(--color-accent)] text-white hover:brightness-110"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
