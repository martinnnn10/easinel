"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { GuidedPmBuilder } from "@/components/GuidedPmBuilder";

interface PmItem {
  id: string;
  title: string;
  assetName: string | null;
  assetId?: string | null;
  failureMode: string | null;
  frequencyLabel: string | null;
  status: string;
  confidence: string | null;
  source: string;
  nextDueAt: number | null;
  reasoning?: string | null;
}

interface AssetOption {
  id: string;
  name: string;
  manufacturer?: string | null;
  model?: string | null;
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

const FREQUENCY_OPTIONS = [
  { value: "30-day", label: "30-day" },
  { value: "60-day", label: "60-day" },
  { value: "90-day", label: "90-day" },
  { value: "quarterly", label: "Quarterly (90 days)" },
  { value: "semi-annual", label: "Semi-annual (182 days)" },
  { value: "annual", label: "Annual (365 days)" },
];

export default function PmPage() {
  const [programs, setPrograms] = useState<PmItem[]>([]);
  const [duePrograms, setDuePrograms] = useState<PmItem[]>([]);
  const [filter, setFilter] = useState<"all" | "draft" | "active" | "due" | "archived">("all");
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

  // ── Manual PM creation modal state ──
  const [showManual, setShowManual] = useState(false);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [manualAssetId, setManualAssetId] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualFrequency, setManualFrequency] = useState("90-day");
  const [manualTasks, setManualTasks] = useState("");
  const [manualTools, setManualTools] = useState("");
  const [manualParts, setManualParts] = useState("");
  const [manualSafety, setManualSafety] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");

  // ── Completion modal state ──
  const [completePm, setCompletePm] = useState<PmItem | null>(null);
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeParts, setCompleteParts] = useState("");
  const [completeIssues, setCompleteIssues] = useState("");
  const [completeFollowUp, setCompleteFollowUp] = useState("");
  const [completeDuration, setCompleteDuration] = useState("");
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState("");

  // ── Generate WO state ──
  const [genWoMsg, setGenWoMsg] = useState<Record<string, string>>({});

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

  const loadDue = useCallback(async () => {
    try {
      const res = await fetch("/api/pm?due=1");
      if (!res.ok) return;
      const data = await res.json();
      setDuePrograms(data.programs ?? []);
    } catch {
      // silent
    }
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/assets");
      if (!res.ok) return;
      const data = await res.json();
      setAssets(data.assets ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    load();
    loadDue();
  }, [load, loadDue]);

  const act = async (id: string, action: "approve" | "archive") => {
    setBusy(id + action);
    await fetch(`/api/pm/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy("");
    load();
    loadDue();
  };

  // ── Manual PM creation ──
  const openManualModal = () => {
    setShowManual(true);
    setManualError("");
    loadAssets();
  };

  const submitManualPm = async () => {
    if (!manualAssetId || !manualTitle.trim() || !manualFrequency) {
      setManualError("Asset, title, and frequency are required.");
      return;
    }
    setManualBusy(true);
    setManualError("");
    try {
      const body: Record<string, unknown> = {
        assetId: manualAssetId,
        title: manualTitle.trim(),
        frequency: manualFrequency,
      };
      if (manualTasks.trim()) body.tasks = manualTasks.split("\n").filter((l) => l.trim());
      if (manualTools.trim()) body.tools = manualTools.split(",").map((s) => s.trim()).filter(Boolean);
      if (manualParts.trim()) body.parts = manualParts.split(",").map((s) => s.trim()).filter(Boolean);
      if (manualSafety.trim()) body.safety = manualSafety.split("\n").filter((l) => l.trim());

      const res = await fetch("/api/pm/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to create PM");
      setShowManual(false);
      setManualTitle("");
      setManualTasks("");
      setManualTools("");
      setManualParts("");
      setManualSafety("");
      load();
    } catch (e) {
      setManualError((e as Error).message);
    } finally {
      setManualBusy(false);
    }
  };

  // ── PM Completion ──
  const openCompletion = (pm: PmItem) => {
    setCompletePm(pm);
    setCompleteNotes("");
    setCompleteParts("");
    setCompleteIssues("");
    setCompleteFollowUp("");
    setCompleteDuration("");
    setCompleteError("");
  };

  const submitCompletion = async () => {
    if (!completePm) return;
    setCompleteBusy(true);
    setCompleteError("");
    try {
      const body: Record<string, unknown> = { status: "done" };
      if (completeNotes.trim()) body.notes = completeNotes.trim();
      if (completeParts.trim()) body.partsUsed = completeParts.trim();
      if (completeIssues.trim()) body.issuesFound = completeIssues.trim();
      if (completeFollowUp.trim()) body.followUp = completeFollowUp.trim();
      if (completeDuration.trim()) body.durationMins = parseInt(completeDuration) || undefined;

      const res = await fetch(`/api/pm/${completePm.id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || d.error || "Failed");
      }
      setCompletePm(null);
      load();
      loadDue();
    } catch (e) {
      setCompleteError((e as Error).message);
    } finally {
      setCompleteBusy(false);
    }
  };

  // ── Generate WO from due PM ──
  const generateWo = async (pmId: string) => {
    setBusy(pmId + "genwo");
    setGenWoMsg({});
    try {
      const res = await fetch(`/api/pm/${pmId}/generate-wo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed");
      setGenWoMsg((prev) => ({ ...prev, [pmId]: `WO created: ${data.title}` }));
      loadDue();
    } catch (e) {
      setGenWoMsg((prev) => ({ ...prev, [pmId]: (e as Error).message }));
    } finally {
      setBusy("");
    }
  };

  // Resolve the manual identity to a probable asset BEFORE generating
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
      await generate();
    } finally {
      setGenerating(false);
    }
  };

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

  // "All" is the working view: active + draft only. Archived/dismissed PMs are
  // hidden here and live behind their own tab so they don't clutter the board.
  const shown = filter === "due"
    ? duePrograms
    : filter === "all"
    ? programs.filter((p) => p.status !== "archived")
    : programs.filter((p) => p.status === filter);
  const drafts = programs.filter((p) => p.status === "draft").length;
  const archivedCount = programs.filter((p) => p.status === "archived").length;
  const dueCount = duePrograms.length;

  return (
    <>
      <TopBar
        title="PM Program"
        subtitle="Plan, approve, and complete preventive maintenance for each machine"
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {/* ── Primary: guided, machine-first PM builder ── */}
          <GuidedPmBuilder onGenerated={() => { load(); loadDue(); }} />

          {/* ── Manual PM creation button ── */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={openManualModal}
              className="text-[13px] font-medium rounded-lg border border-[var(--color-accent)] text-[var(--color-accent)] px-4 py-2 hover:bg-[var(--color-accent)]/10 transition"
            >
              + Create Manual PM
            </button>
          </div>

          {/* ── Advanced: free-text generate / upload a PM document ── */}
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] mb-5 overflow-hidden">
            <button
              onClick={() => setShowGen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-surface-2)]/50 transition"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-surface-2)] grid place-items-center text-[var(--color-muted)]">⚙️</div>
                <div>
                  <div className="text-[14px] font-semibold">Advanced: generate from model/serial or a document</div>
                  <div className="text-[12px] text-[var(--color-muted)]">
                    Type the identity directly, or upload an OEM manual / PM schedule to ground the program
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

                {/* Confirm-before-save panel */}
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
                  <InputField label="Manufacturer" value={manufacturer} onChange={setManufacturer} placeholder="e.g. SEW-Eurodrive" />
                  <InputField label="Model number" value={model} onChange={setModel} placeholder="e.g. R97 DRN100LS4" />
                  <InputField label="Serial number" value={serial} onChange={setSerial} placeholder="e.g. 01.1234567890.0001.18" />
                  <InputField label="Machine type (optional)" value={assetType} onChange={setAssetType} placeholder="conveyor, pump, gearbox, drive…" />
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

          {/* ── Filter tabs ── Working views on the left; Archived pushed to the
              right and visually quieter so dismissed PMs never crowd the board. */}
          <div className="flex items-center gap-1.5 mb-4">
            {(["all", "draft", "active", "due"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[12px] px-3 py-1 rounded-full border capitalize transition ${
                  filter === f
                    ? "border-[var(--color-accent)] text-[var(--color-text)] bg-[var(--color-accent)]/10"
                    : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {f === "due" ? `Due / Overdue${dueCount > 0 ? ` (${dueCount})` : ""}` : f}
                {f === "draft" && drafts > 0 ? ` (${drafts})` : ""}
              </button>
            ))}
            {archivedCount > 0 && (
              <button
                onClick={() => setFilter("archived")}
                className={`ml-auto text-[12px] px-3 py-1 rounded-full border transition ${
                  filter === "archived"
                    ? "border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-surface-2)]"
                    : "border-transparent text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                }`}
              >
                Archived ({archivedCount})
              </button>
            )}
          </div>

          {/* ── PM List ── */}
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
              <p className="text-[15px] font-medium">
                {filter === "due" ? "No PMs are due right now" : "No PM programs yet"}
              </p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">
                {filter === "due"
                  ? "All active PMs are up to date. When a PM becomes overdue, it will appear here with an option to generate a work order."
                  : <>Use <span className="text-[var(--color-text)]">Generate a PM program</span> above to build a full 30/60/90-day, semi-annual, and annual schedule from a machine&apos;s model or serial number — or close a corrective work order and ask the Copilot <span className="text-[var(--color-text)]">&quot;Should this become a PM?&quot;</span></>
                }
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border-soft)]">
              {shown.map((p) => {
                const archived = p.status === "archived";
                return (
                  <div
                    key={p.id}
                    className={`px-3.5 py-2.5 hover:bg-[var(--color-surface-2)]/40 transition ${archived ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* status dot — carries the state so we don't need a badge for it */}
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: statusColor[p.status] ?? "var(--color-faint)" }}
                        title={p.status}
                      />
                      <Link href={`/pm/${p.id}`} className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-[var(--color-text)] truncate">{p.title}</span>
                          {p.source === "ai_suggested" && p.status === "draft" && (
                            <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-[var(--color-accent)] bg-[var(--color-accent)]/10">
                              AI
                            </span>
                          )}
                        </div>
                        {/* One clear secondary line: machine · cadence · (due / confidence) */}
                        <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)] mt-0.5 truncate">
                          <span className="truncate">{p.assetName || "Unassigned"}</span>
                          <span className="text-[var(--color-faint)]">·</span>
                          <span className="shrink-0">{p.frequencyLabel ?? "—"}</span>
                          {filter === "due" && p.nextDueAt && (
                            <>
                              <span className="text-[var(--color-faint)]">·</span>
                              <span className="shrink-0 text-[var(--color-red)]">overdue {new Date(p.nextDueAt).toLocaleDateString()}</span>
                            </>
                          )}
                          {p.confidence && p.status === "draft" && (
                            <>
                              <span className="text-[var(--color-faint)]">·</span>
                              <span className="shrink-0" style={{ color: confColor[p.confidence] }}>{p.confidence} confidence</span>
                            </>
                          )}
                        </div>
                      </Link>

                      {/* Status word only where it isn't implied by the current tab */}
                      {filter === "all" && (p.status === "draft" || p.status === "active") && (
                        <span
                          className="hidden sm:inline text-[10px] uppercase tracking-wide shrink-0"
                          style={{ color: statusColor[p.status] }}
                        >
                          {p.status}
                        </span>
                      )}

                      {/* Actions — compact, inline */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.status === "draft" && (
                          <>
                            <button
                              disabled={busy === p.id + "approve"}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); act(p.id, "approve"); }}
                              className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1 hover:brightness-110 disabled:opacity-50"
                            >
                              {busy === p.id + "approve" ? "…" : "Approve"}
                            </button>
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); act(p.id, "archive"); }}
                              className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-red)] px-1"
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                        {p.status === "active" && filter !== "due" && (
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openCompletion(p); }}
                            className="text-[12px] font-medium rounded-lg border border-[var(--color-border)] px-3 py-1 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]"
                          >
                            Mark done
                          </button>
                        )}
                        {filter === "due" && (
                          <>
                            <button
                              disabled={busy === p.id + "genwo"}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); generateWo(p.id); }}
                              className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1 hover:brightness-110 disabled:opacity-50"
                            >
                              {busy === p.id + "genwo" ? "…" : "Generate WO"}
                            </button>
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openCompletion(p); }}
                              className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-text)] px-1"
                            >
                              Done
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {filter === "due" && genWoMsg[p.id] && (
                      <p className={`text-[11px] mt-1.5 pl-[18px] ${genWoMsg[p.id].startsWith("WO created") ? "text-[var(--color-green)]" : "text-[var(--color-red)]"}`}>
                        {genWoMsg[p.id]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Manual PM Creation Modal ── */}
      {showManual && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
          onClick={() => { if (!manualBusy) setShowManual(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Create manual PM"
        >
          <div
            className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-[15px] mb-1">Create Manual PM</h2>
            <p className="text-[12px] text-[var(--color-muted)] mb-4">
              Define a preventive maintenance schedule for a machine. It will be saved as a draft for approval.
            </p>

            {manualError && (
              <div className="mb-3 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-3 py-2 text-[12px] text-[var(--color-red)]" role="alert">
                {manualError}
              </div>
            )}

            <div className="space-y-3">
              {/* Asset dropdown */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Asset / Machine *</span>
                <select
                  value={manualAssetId}
                  onChange={(e) => setManualAssetId(e.target.value)}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">Select an asset…</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.manufacturer ? ` (${a.manufacturer}${a.model ? ` ${a.model}` : ""})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {/* Title */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">PM Title *</span>
                <input
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g. Quarterly gearbox oil change"
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              {/* Frequency */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Frequency *</span>
                <select
                  value={manualFrequency}
                  onChange={(e) => setManualFrequency(e.target.value)}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                >
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>

              {/* Tasks */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Tasks (one per line)</span>
                <textarea
                  value={manualTasks}
                  onChange={(e) => setManualTasks(e.target.value)}
                  placeholder={"Drain old oil\nReplace filter element\nRefill with ISO VG 220\nCheck for leaks"}
                  rows={4}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)] resize-none"
                />
              </label>

              {/* Tools */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Tools (comma-separated)</span>
                <input
                  value={manualTools}
                  onChange={(e) => setManualTools(e.target.value)}
                  placeholder="e.g. Oil drain pan, torque wrench, filter wrench"
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              {/* Parts */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Parts (comma-separated)</span>
                <input
                  value={manualParts}
                  onChange={(e) => setManualParts(e.target.value)}
                  placeholder="e.g. Oil filter, 5L ISO VG 220 oil, gasket"
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              {/* Safety */}
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Safety notes (one per line)</span>
                <textarea
                  value={manualSafety}
                  onChange={(e) => setManualSafety(e.target.value)}
                  placeholder={"LOTO required\nWear nitrile gloves\nAllow oil to cool before draining"}
                  rows={3}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)] resize-none"
                />
              </label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
              <button
                onClick={() => setShowManual(false)}
                className="text-[13px] px-3 py-2.5 sm:py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
              <button
                disabled={manualBusy || !manualAssetId || !manualTitle.trim()}
                onClick={submitManualPm}
                className="text-[13px] font-medium px-4 py-2.5 sm:py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 hover:brightness-110"
              >
                {manualBusy ? "Creating…" : "Create PM (draft)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Completion Modal ── */}
      {completePm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
          onClick={() => { if (!completeBusy) setCompletePm(null); }}
          role="dialog"
          aria-modal="true"
          aria-label="Complete PM"
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-[15px] mb-1">Complete PM</h2>
            <p className="text-[12px] text-[var(--color-muted)] mb-4">
              {completePm.title} · {completePm.assetName || "Unknown asset"}
            </p>

            {completeError && (
              <div className="mb-3 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-3 py-2 text-[12px] text-[var(--color-red)]" role="alert">
                {completeError}
              </div>
            )}

            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Notes</span>
                <textarea
                  autoFocus
                  value={completeNotes}
                  onChange={(e) => setCompleteNotes(e.target.value)}
                  placeholder="Any observations during the PM…"
                  rows={3}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)] resize-none"
                />
              </label>

              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Parts used</span>
                <input
                  value={completeParts}
                  onChange={(e) => setCompleteParts(e.target.value)}
                  placeholder="e.g. Oil filter, 5L VG220"
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                />
              </label>

              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Issues found</span>
                <textarea
                  value={completeIssues}
                  onChange={(e) => setCompleteIssues(e.target.value)}
                  placeholder="Any defects, wear, or concerns discovered…"
                  rows={2}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)] resize-none"
                />
              </label>

              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Follow-up needed</span>
                <textarea
                  value={completeFollowUp}
                  onChange={(e) => setCompleteFollowUp(e.target.value)}
                  placeholder="Any corrective work or further inspection needed…"
                  rows={2}
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)] resize-none"
                />
              </label>

              <label className="block">
                <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Duration (minutes)</span>
                <input
                  type="number"
                  value={completeDuration}
                  onChange={(e) => setCompleteDuration(e.target.value)}
                  placeholder="e.g. 45"
                  className="mt-1 w-full text-[13px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
              <button
                onClick={() => setCompletePm(null)}
                className="text-[13px] px-3 py-2.5 sm:py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
              <button
                disabled={completeBusy}
                onClick={submitCompletion}
                className="text-[13px] font-medium px-4 py-2.5 sm:py-1.5 rounded-lg bg-[var(--color-green)] text-white disabled:opacity-40 hover:brightness-110"
              >
                {completeBusy ? "Completing…" : "Mark done"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InputField({
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
