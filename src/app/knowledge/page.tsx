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
  assetId?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  plcProjectId?: string;
  plcFidelity?: string;
}

interface DrawingInfo {
  drawingNumber: string | null;
  revision: string | null;
  title: string | null;
  area: string | null;
  equipmentTags: string[];
  panels: string[];
  plcRefs: string[];
  wireNumbers: string[];
  components: string[];
}

interface DocDetail {
  document: Doc & { assetId?: string | null; mimeType?: string | null; storagePath?: string | null };
  asset: { id: string; name: string } | null;
  indexed: boolean;
  chunkCount: number;
  textPreview: string;
  hasOriginal: boolean;
  drawing?: DrawingInfo | null;
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
  rca: { icon: "🧭", label: "Root Cause Analysis" },
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
  // Document detail drawer — opens for ANY document (not just PLC) so an upload
  // is never a dead click.
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const openDoc = async (d: Doc) => {
    // PLC files keep their rich behavior: full L5X → Explorer; ACD → export guide.
    if (d.plcProjectId) {
      if (d.plcFidelity === "full") router.push(`/plc/${d.plcProjectId}`);
      else setAcdGuide({ id: d.plcProjectId, filename: d.filename });
      return;
    }
    // Every other document opens a detail drawer with its metadata, status,
    // extracted-text preview, linked asset, and an open-original action.
    setDetailLoading(true);
    setDetail({ document: d, asset: null, indexed: (d.charCount ?? 0) > 0, chunkCount: 0, textPreview: "", hasOriginal: false });
    try {
      const r = await fetch(`/api/knowledge/${d.id}`);
      if (r.ok) setDetail(await r.json());
    } finally {
      setDetailLoading(false);
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
                    role="button"
                    tabIndex={0}
                    onClick={() => openDoc(d)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDoc(d);
                      }
                    }}
                    className={`flex items-center gap-3 px-4 py-3 transition cursor-pointer ${
                      i > 0 ? "border-t border-[var(--color-border-soft)]" : ""
                    } ${
                      isPlc
                        ? "hover:bg-[var(--color-accent)]/[0.06]"
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

                    <span className="text-[11px] font-medium text-[var(--color-accent)] whitespace-nowrap">
                      {isPlc ? "Open in PLC Explorer →" : "Open →"}
                    </span>

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

      {detail && (
        <DocumentDrawer
          detail={detail}
          loading={detailLoading}
          onClose={() => setDetail(null)}
          onAskCopilot={(d) =>
            router.push(d.asset?.id ? `/assets/${d.asset.id}?tab=ai` : `/copilot`)
          }
        />
      )}
    </>
  );
}

// Detail drawer for any uploaded document. Shows metadata, indexing status, the
// linked asset, the extracted-text preview, and an honest open-original action.
function DocumentDrawer({
  detail,
  loading,
  onClose,
  onAskCopilot,
}: {
  detail: DocDetail;
  loading: boolean;
  onClose: () => void;
  onAskCopilot: (d: DocDetail) => void;
}) {
  const d = detail.document;
  const meta = kindMeta[d.kind] ?? kindMeta.document;
  const fmtDate = (ts?: number) =>
    ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-y-auto fadeup"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Document detail"
      >
        <div className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-5 py-4 flex items-start gap-3">
          <span className="text-2xl">{meta.icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold break-words">{d.filename}</h2>
            <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{meta.label}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--color-faint)] hover:text-[var(--color-text)] text-lg leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Facts */}
          <div className="grid grid-cols-2 gap-2.5">
            <Fact label="Type" value={d.mimeType || meta.label} />
            <Fact label="Uploaded" value={fmtDate(d.createdAt)} />
            <Fact label="Size" value={d.sizeBytes ? `${(d.sizeBytes / 1024).toFixed(0)} KB` : "—"} />
            <Fact
              label="Indexing"
              value={detail.indexed ? `Indexed · ${detail.chunkCount} chunks` : "Stored (no text index)"}
              good={detail.indexed}
            />
          </div>

          {/* Linked asset / asset-first affordance */}
          <div className="rounded-xl border border-[var(--color-border)] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5">Linked machine</p>
            {detail.asset ? (
              <a href={`/assets/${detail.asset.id}`} className="text-[13px] text-[var(--color-accent)] hover:underline">
                {detail.asset.name} →
              </a>
            ) : (
              <p className="text-[12.5px] text-[var(--color-amber)]">
                ⚠ Needs asset assignment — this document isn’t linked to a machine yet.
              </p>
            )}
          </div>

          {/* Inline viewer — render PDFs and images directly in the panel so a
              drawing/manual can be SEEN on screen, not just downloaded. Falls
              back silently to the Open/Download actions below for other types
              or if the embed fails to load. */}
          {detail.hasOriginal && (() => {
            const mime = d.mimeType ?? "";
            const isPdf = mime === "application/pdf" || (d.filename ?? "").toLowerCase().endsWith(".pdf");
            const isImg = mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(d.filename ?? "");
            const src = `/api/knowledge/${d.id}/file`;
            if (!isPdf && !isImg) return null;
            return (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Preview</p>
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--color-accent)] hover:underline"
                  >
                    Open full size ↗
                  </a>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-bg)]">
                  {isPdf ? (
                    <iframe
                      src={`${src}#toolbar=1&navpanes=0&view=FitH`}
                      title={`Preview of ${d.filename}`}
                      className="w-full h-[420px] bg-white"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt={`Preview of ${d.filename}`}
                      className="w-full max-h-[420px] object-contain bg-white"
                    />
                  )}
                </div>
              </div>
            );
          })()}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {detail.hasOriginal ? (
              <>
                <a
                  href={`/api/knowledge/${d.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12.5px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-2 hover:brightness-110"
                >
                  Open original
                </a>
                <a
                  href={`/api/knowledge/${d.id}/file?download=1`}
                  className="text-[12.5px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-2 hover:bg-[var(--color-surface-2)]"
                >
                  Download
                </a>
              </>
            ) : (
              <span className="text-[12px] text-[var(--color-faint)]">
                No stored original to open — this item’s text was indexed directly.
              </span>
            )}
            <button
              onClick={() => onAskCopilot(detail)}
              className="text-[12.5px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-2 hover:bg-[var(--color-surface-2)]"
            >
              Ask the Copilot
            </button>
          </div>

          {/* Drawing intelligence — HONEST facts parsed from the indexed text */}
          <DrawingIntelligence drawing={detail.drawing} />

          {/* Extracted text preview */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5">Extracted text preview</p>
            {loading ? (
              <div className="h-24 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
            ) : detail.textPreview ? (
              <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 max-h-80 overflow-y-auto font-sans">
                {detail.textPreview}
              </pre>
            ) : (
              <p className="text-[12.5px] text-[var(--color-muted)]">
                No extractable text was indexed for this file
                {d.kind === "photo" || (d.mimeType ?? "").startsWith("image/")
                  ? " (image — the Copilot reads it visually on demand)."
                  : d.mimeType === "application/pdf"
                  ? " (even after OCR, no readable text was found — the scan may be too low-quality)."
                  : "."}{" "}
                You can still open the original above.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// HONEST electrical-drawing facts. Renders nothing unless at least one field is
// populated — an image-only/scanned drawing (no extractable text) shows nothing
// here, matching the honest "no extractable text" note in the preview section.
function DrawingIntelligence({ drawing }: { drawing?: DrawingInfo | null }) {
  if (!drawing) return null;
  const hasAny =
    !!drawing.drawingNumber ||
    !!drawing.revision ||
    !!drawing.title ||
    !!drawing.area ||
    drawing.equipmentTags.length > 0 ||
    drawing.panels.length > 0 ||
    drawing.plcRefs.length > 0 ||
    drawing.wireNumbers.length > 0 ||
    drawing.components.length > 0;
  if (!hasAny) return null;

  const dwgLine = [
    drawing.drawingNumber ? `Drawing no. ${drawing.drawingNumber}` : null,
    drawing.revision ? `Rev ${drawing.revision}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5">
        Drawing intelligence
      </p>
      <div className="rounded-xl border border-[var(--color-border)] p-3 space-y-2.5">
        {dwgLine && (
          <p className="text-[12.5px] font-medium">{dwgLine}</p>
        )}
        {drawing.title && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Title</p>
            <p className="text-[12.5px] mt-0.5 break-words">{drawing.title}</p>
          </div>
        )}
        {drawing.area && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">Area</p>
            <p className="text-[12.5px] mt-0.5 break-words">{drawing.area}</p>
          </div>
        )}
        <ChipRow label="Equipment tags" items={drawing.equipmentTags} />
        <ChipRow label="Panels" items={drawing.panels} />
        <ChipRow label="PLC refs" items={drawing.plcRefs} />
        <ChipRow label="Wire numbers" items={drawing.wireNumbers} />
        <ChipRow label="Components" items={drawing.components} />
      </div>
      <p className="text-[11px] text-[var(--color-faint)] mt-1.5">
        Parsed from the indexed drawing text — verify against the original.
      </p>
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text)] bg-[var(--color-surface-2)]"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</p>
      <p className={`text-[12.5px] font-medium mt-0.5 ${good ? "text-[var(--color-green)]" : ""}`}>{value}</p>
    </div>
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
