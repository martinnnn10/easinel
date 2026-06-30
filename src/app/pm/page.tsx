"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface PmItem {
  id: string;
  title: string;
  assetName: string | null;
  failureMode: string | null;
  frequencyLabel: string | null;
  status: string;
  confidence: string | null;
  source: string;
  nextDueAt: number | null;
  reasoning?: string | null;
}

interface GeneratedCadence {
  cadenceKey: string;
  programId: string;
  title: string;
  intervalDays: number;
  taskCount: number;
}
interface GenerateResult {
  matchedAssetId: string | null;
  evidenceCount: number;
  groundedInDocs: boolean;
  cadences: GeneratedCadence[];
  note: string;
}

interface DetectedIdentity {
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  assetType: string | null;
  cadenceHints: string[];
  method: string;
}
interface AnalyzeAssetMatch {
  asset: { id: string; name: string; assetTag: string | null };
  confidence: number;
  why: string;
}
interface AnalyzeResolution {
  bestMatch: AnalyzeAssetMatch | null;
  candidates: AnalyzeAssetMatch[];
  newAssetDraft: {
    name: string;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    assetType: string | null;
  };
  suggestedNumber: string;
}
interface AnalyzeResult {
  filename: string;
  extractStatus: string;
  readable: boolean;
  detail?: string;
  identity: DetectedIdentity;
  resolution: AnalyzeResolution | null;
  summary: string;
}

const statusColor: Record<string, string> = {
  draft: "var(--color-amber)",
  active: "var(--color-green)",
  archived: "var(--color-faint)",
};
const confColor: Record<string, string> = {
  high: "var(--color-green)",
  medium: "var(--color-amber)",
  low: "var(--color-faint)",
};

export default function PmPage() {
  const [programs, setPrograms] = useState<PmItem[]>([]);
  const [filter, setFilter] = useState<"all" | "draft" | "active">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>("");

  // ── Generate-PM panel state ──
  const [showGen, setShowGen] = useState(false);
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [assetType, setAssetType] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);
  const [genError, setGenError] = useState("");

  // ── PM document upload state ──
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  // ── Confirm-before-save (PM upload intelligence) state ──
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [confirmTag, setConfirmTag] = useState("");
  const [confirmChoice, setConfirmChoice] = useState<"match" | "new">("new");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pm");
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load PMs");
      setPrograms((await res.json()).programs ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "approve" | "archive") => {
    setBusy(id + action);
    await fetch(`/api/pm/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy("");
    load();
  };

  // Resolve the manual identity to a probable asset BEFORE generating, so the
  // PM links to a machine instead of landing "Unassigned". Reuses the same
  // confirm-before-save panel as the upload flow.
  const resolveThenGenerate = async () => {
    setGenError("");
    setGenResult(null);
    if (!manufacturer.trim() && !model.trim() && !serial.trim()) {
      setGenError("Enter at least a model number, serial number, or manufacturer.");
      return;
    }
    setGenerating(true);
    try {
      const rr = (await fetch("/api/assets/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
          serialNumber: serial.trim() || null,
          assetType: assetType.trim() || null,
          text: [manufacturer, model].filter(Boolean).join(" ") || null,
        }),
      }).then((x) => x.json())) as AnalyzeResolution;
      // Present the confirm panel (existing match or create-new) before saving.
      setConfirmTag(rr.suggestedNumber || "");
      setConfirmChoice(rr.bestMatch ? "match" : "new");
      setAnalysis({
        filename: "manual entry",
        extractStatus: "manual",
        readable: true,
        identity: {
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
          serialNumber: serial.trim() || null,
          assetType: assetType.trim() || null,
          cadenceHints: [],
          method: "manual",
        },
        resolution: rr,
        summary: rr.bestMatch
          ? `This looks like an existing machine (${rr.bestMatch.asset.name}). Confirm to link the PMs to it, or create a new asset.`
          : `No existing machine matched. A new asset will be created (number ${rr.suggestedNumber}) and the PMs linked to it.`,
      });
    } catch {
      // If resolve fails for any reason, fall back to generating without an asset.
      await generate();
    } finally {
      setGenerating(false);
    }
  };

  // Run generation. Optional overrides let the confirm-before-save flow pass a
  // confirmed assetId (existing) or a new-asset spec (with editable number).
  const generate = async (overrides?: {
    assetId?: string;
    createAsset?: {
      name: string;
      assetTag: string;
      manufacturer: string | null;
      model: string | null;
      serialNumber: string | null;
      assetType: string | null;
    };
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    assetType?: string | null;
  }) => {
    setGenError("");
    setGenResult(null);
    const body = overrides ?? {
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serialNumber: serial.trim() || null,
      assetType: assetType.trim() || null,
    };
    if (
      !overrides &&
      !manufacturer.trim() &&
      !model.trim() &&
      !serial.trim()
    ) {
      setGenError("Enter at least a model number, serial number, or manufacturer.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/pm/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setGenResult(data as GenerateResult);
      setAnalysis(null);
      load();
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  // Confirm the detected/edited asset, then generate the PM program.
  const confirmAndGenerate = () => {
    if (!analysis || !analysis.resolution) return;
    const r = analysis.resolution;
    if (confirmChoice === "match" && r.bestMatch) {
      generate({ assetId: r.bestMatch.asset.id });
    } else {
      generate({
        createAsset: {
          name: r.newAssetDraft.name,
          assetTag: (confirmTag || r.suggestedNumber).trim(),
          manufacturer: r.newAssetDraft.manufacturer,
          model: r.newAssetDraft.model,
          serialNumber: r.newAssetDraft.serialNumber,
          assetType: r.newAssetDraft.assetType,
        },
      });
    }
  };

  // Upload a PM document → DETECT the machine first (saves nothing), then show a
  // confirmation panel. Only after the user confirms the asset do we generate.
  const uploadPmDocs = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    setUploadMsg("");
    setAnalysis(null);
    setGenResult(null);
    setGenError("");
    try {
      const fd = new FormData();
      fd.append("file", files[0]);
      const res = await fetch("/api/pm/analyze-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      const result = data as AnalyzeResult;
      // Prefill the manual form from the detection so the user can edit.
      setManufacturer(result.identity.manufacturer ?? "");
      setModel(result.identity.model ?? "");
      setSerial(result.identity.serialNumber ?? "");
      setAssetType(result.identity.assetType ?? "");
      if (result.resolution) {
        setConfirmTag(result.resolution.suggestedNumber);
        setConfirmChoice(result.resolution.bestMatch ? "match" : "new");
      }
      setAnalysis(result);
      setUploadMsg(
        result.readable
          ? `Analyzed "${result.filename}" — confirm the machine below to save the PM program.`
          : `Read "${result.filename}" but couldn't auto-detect the machine — enter details below.`
      );
    } catch (e) {
      setUploadMsg((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const shown = programs.filter((p) => (filter === "all" ? true : p.status === filter));
  const drafts = programs.filter((p) => p.status === "draft").length;

  return (
    <>
      <TopBar
        title="PM Program"
        subtitle="Generate a full PM schedule from a machine's model/serial, or approve AI proposals from real repairs"
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {/* ── Generate PM Program ── */}
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] mb-5 overflow-hidden">
            <button
              onClick={() => setShowGen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-surface-2)]/50 transition"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 grid place-items-center text-[var(--color-accent)]">⚙️</div>
                <div>
                  <div className="text-[14px] font-semibold">Generate a PM program from a machine</div>
                  <div className="text-[12px] text-[var(--color-muted)]">
                    Enter a model or serial number → get 30/60/90-day, semi-annual &amp; annual PMs as drafts
                  </div>
                </div>
              </div>
              <span className="text-[var(--color-faint)] text-lg">{showGen ? "−" : "+"}</span>
            </button>

            {showGen && (
              <div className="px-4 pb-4 border-t border-[var(--color-border)] pt-4">
                {/* PM document upload */}
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 mb-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-[12px] text-[var(--color-muted)] max-w-md">
                      <span className="text-[var(--color-text)] font-medium">Upload PM documents first (recommended).</span>{" "}
                      OEM manuals, PM schedules, or maintenance checklists make the generated PMs grounded and machine-specific. Text PDFs, Word, Excel, and CSV are indexed for search.
                    </div>
                    <div className="shrink-0">
                      <input
                        ref={fileInput}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => uploadPmDocs(e.target.files)}
                      />
                      <button
                        onClick={() => fileInput.current?.click()}
                        disabled={uploading}
                        className="text-[12px] font-medium rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]/50 disabled:opacity-50"
                      >
                        {uploading ? "Uploading…" : "Upload PM documents"}
                      </button>
                    </div>
                  </div>
                  {uploadMsg && (
                    <p className="text-[12px] text-[var(--color-green)] mt-2">{uploadMsg}</p>
                  )}
                </div>

                {/* Confirm-before-save panel (PM upload intelligence) */}
                {analysis && analysis.resolution && (
                  <div className="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-3 mb-4">
                    <div className="text-[12px] font-semibold text-[var(--color-text)]">Confirm the machine before saving</div>
                    <p className="text-[12px] text-[var(--color-muted)] mt-1">{analysis.summary}</p>

                    <div className="mt-3 space-y-2">
                      {analysis.resolution.bestMatch && (
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="assetChoice"
                            checked={confirmChoice === "match"}
                            onChange={() => setConfirmChoice("match")}
                            className="mt-0.5"
                          />
                          <span className="text-[12px] text-[var(--color-text)]">
                            Use existing asset <span className="font-medium">{analysis.resolution.bestMatch.asset.name}</span>
                            {analysis.resolution.bestMatch.asset.assetTag ? ` (${analysis.resolution.bestMatch.asset.assetTag})` : ""}{" "}
                            <span className="text-[var(--color-faint)]">— {Math.round(analysis.resolution.bestMatch.confidence * 100)}% · {analysis.resolution.bestMatch.why}</span>
                          </span>
                        </label>
                      )}
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="assetChoice"
                          checked={confirmChoice === "new"}
                          onChange={() => setConfirmChoice("new")}
                          className="mt-0.5"
                        />
                        <span className="text-[12px] text-[var(--color-text)]">
                          Create a new asset: <span className="font-medium">{analysis.resolution.newAssetDraft.name}</span>
                        </span>
                      </label>
                    </div>

                    {confirmChoice === "new" && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Asset number (editable)</span>
                        <input
                          value={confirmTag}
                          onChange={(e) => setConfirmTag(e.target.value)}
                          className="text-[13px] font-mono rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-1.5 outline-none focus:border-[var(--color-accent)]/60"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={confirmAndGenerate}
                        disabled={generating}
                        className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110 disabled:opacity-50"
                      >
                        {generating ? "Saving PM program…" : "Confirm & save PM program"}
                      </button>
                      <button
                        onClick={() => { setAnalysis(null); setUploadMsg(""); }}
                        className="text-[12px] text-[var(--color-faint)] hover:text-[var(--color-text)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Manufacturer" value={manufacturer} onChange={setManufacturer} placeholder="e.g. SEW-Eurodrive" />
                  <Field label="Model number" value={model} onChange={setModel} placeholder="e.g. R97 DRN100LS4" />
                  <Field label="Serial number" value={serial} onChange={setSerial} placeholder="e.g. 01.1234567890.0001.18" />
                  <Field label="Machine type (optional)" value={assetType} onChange={setAssetType} placeholder="conveyor, pump, gearbox, drive…" />
                </div>

                {genError && (
                  <p className="text-[12px] text-[var(--color-red)] mt-3">{genError}</p>
                )}

                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={() => resolveThenGenerate()}
                    disabled={generating}
                    className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110 disabled:opacity-50"
                  >
                    {generating ? "Working…" : "Generate PM program"}
                  </button>
                  <span className="text-[11px] text-[var(--color-faint)]">
                    You&apos;ll confirm the machine to link, then each PM is saved as a DRAFT — a manager approves before it schedules work.
                  </span>
                </div>

                {genResult && (
                  <div className="mt-4 rounded-xl border border-[var(--color-green)]/30 bg-[var(--color-green)]/5 p-3">
                    <p className="text-[12px] text-[var(--color-text)]">{genResult.note}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {genResult.cadences.map((c) => (
                        <span key={c.cadenceKey} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                          {c.title.split(" PM")[0]} · {c.taskCount} tasks
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-[var(--color-faint)] mt-2">
                      {genResult.groundedInDocs
                        ? `Grounded in ${genResult.evidenceCount} evidence item(s). Review the drafts below and Approve to activate.`
                        : "No machine-specific docs were found — these use machine-type best practice. Upload the OEM manual and regenerate to ground them."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 mb-5">
            {(["all", "draft", "active"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[12px] px-3 py-1 rounded-full border capitalize transition ${
                  filter === f
                    ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-accent)]/10"
                    : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {f}
                {f === "draft" && drafts > 0 ? ` (${drafts})` : ""}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[var(--color-red)]/40 bg-[var(--color-red)]/5 p-4 text-[13px] text-[var(--color-red)]">
              {error}{" "}
              <button onClick={load} className="underline">Retry</button>
            </div>
          ) : shown.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl">
              <div className="w-12 h-12 mx-auto rounded-xl bg-[var(--color-surface-2)] grid place-items-center mb-4 text-xl">📅</div>
              <p className="text-[15px] font-medium">No PM programs yet</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">
                Use <span className="text-[var(--color-text)]">Generate a PM program</span> above to build a full
                30/60/90-day, semi-annual, and annual schedule from a machine's model or serial number — or close a
                corrective work order and ask the Copilot <span className="text-[var(--color-text)]">“Should this become a PM?”</span>
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {shown.map((p) => (
                <Link
                  key={p.id}
                  href={`/pm/${p.id}`}
                  className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]/40 transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                          style={{ color: statusColor[p.status], background: "var(--color-surface-2)" }}
                        >
                          {p.status}
                        </span>
                        {p.source === "ai_suggested" && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full text-[var(--color-accent)] bg-[var(--color-accent)]/10">
                            🤖 AI proposed
                          </span>
                        )}
                        {p.confidence && (
                          <span className="text-[10px]" style={{ color: confColor[p.confidence] }}>
                            ● {p.confidence} confidence
                          </span>
                        )}
                      </div>
                      <h3 className="text-[14px] font-semibold mt-1.5 truncate">{p.title}</h3>
                      <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                        {p.assetName ? `${p.assetName} · ` : ""}
                        {p.frequencyLabel ?? "—"}
                        {p.failureMode ? ` · prevents: ${p.failureMode}` : ""}
                      </p>
                      {p.reasoning && (
                        <p className="text-[12px] text-[var(--color-faint)] mt-2 leading-snug line-clamp-2">{p.reasoning}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                        {p.status === "draft" && (
                        <>
                          <button
                            disabled={busy === p.id + "approve"}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); act(p.id, "approve"); }}
                            className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
                          >
                            {busy === p.id + "approve" ? "…" : "Approve"}
                          </button>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); act(p.id, "archive"); }}
                            className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-red)]"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                      {p.status === "active" && (
                        <button
                          onClick={async (e) => {
                            e.preventDefault(); e.stopPropagation();
                            await fetch(`/api/pm/${p.id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" }) });
                            load();
                          }}
                          className="text-[12px] font-medium rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]/50"
                        >
                          Mark done
                        </button>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]/60"
      />
    </label>
  );
}
