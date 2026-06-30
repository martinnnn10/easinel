"use client";

// ─────────────────────────────────────────────────────────────────────────
// Guided PM builder — "What are we maintaining?"
//
// Maintenance never thinks "Annual PM." It thinks "Conveyor 4 — Quarterly
// Inspection." So this wizard refuses to start from a bare cadence: it walks
// component → manufacturer → model → serial → FIND/CONFIRM THE MACHINE, and only
// then generates. The PM is always linked to a real asset (existing or created
// here) — never an orphan.
// ─────────────────────────────────────────────────────────────────────────

import { useState } from "react";

const COMPONENTS: { label: string; assetType: string }[] = [
  { label: "Motor", assetType: "motor" },
  { label: "Gearbox", assetType: "gearbox" },
  { label: "Pump", assetType: "pump" },
  { label: "Conveyor", assetType: "conveyor" },
  { label: "Compressor", assetType: "compressor" },
  { label: "Hydraulic Unit", assetType: "hydraulic" },
  { label: "Robot", assetType: "robot" },
  { label: "PLC Cabinet", assetType: "plc" },
  { label: "Electrical Panel", assetType: "panel" },
  { label: "Other", assetType: "" },
];

interface Candidate {
  asset: { id: string; name: string; assetTag: string | null };
  confidence: number;
  why: string;
}
interface IdentifyResult {
  bestMatch: Candidate | null;
  candidates: Candidate[];
  newAssetDraft: { name: string; manufacturer: string | null; model: string | null; serialNumber: string | null; assetType: string | null };
  suggestedNumber: string;
}
interface GenResult { note: string; cadences: { cadenceKey: string; title: string; taskCount: number }[]; groundedInDocs: boolean; }

export function GuidedPmBuilder({ onGenerated }: { onGenerated: () => void }) {
  const [step, setStep] = useState(1);
  const [componentLabel, setComponentLabel] = useState("");
  const [assetType, setAssetType] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");

  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<IdentifyResult | null>(null);
  const [choice, setChoice] = useState<string>("new"); // assetId | "new"
  const [tag, setTag] = useState("");

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(1); setComponentLabel(""); setAssetType(""); setManufacturer(""); setModel(""); setSerial("");
    setResolution(null); setChoice("new"); setTag(""); setResult(null); setError("");
  };

  // Step 5: find/confirm the machine before any PM exists.
  const findMachine = async () => {
    setResolving(true);
    setError("");
    try {
      const res = await fetch("/api/assets/identify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
          serialNumber: serial.trim() || null,
          assetType: assetType || null,
          text: [componentLabel, manufacturer, model].filter(Boolean).join(" ") || null,
        }),
      });
      const data = (await res.json()) as IdentifyResult;
      if (!res.ok) throw new Error((data as unknown as { error?: string }).error || "Lookup failed");
      setResolution(data);
      setTag(data.suggestedNumber || "");
      setChoice(data.bestMatch ? data.bestMatch.asset.id : "new");
      setStep(5);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const generate = async () => {
    if (!resolution) return;
    setGenerating(true);
    setError("");
    try {
      const body =
        choice === "new"
          ? {
              createAsset: {
                name: resolution.newAssetDraft.name,
                assetTag: (tag || resolution.suggestedNumber).trim(),
                manufacturer: resolution.newAssetDraft.manufacturer,
                model: resolution.newAssetDraft.model,
                serialNumber: resolution.newAssetDraft.serialNumber,
                assetType: resolution.newAssetDraft.assetType || assetType || null,
              },
            }
          : { assetId: choice };
      const res = await fetch("/api/pm/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data as GenResult);
      setStep(6);
      onGenerated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const machineLine = [manufacturer, model].filter(Boolean).join(" ") || componentLabel || "this machine";

  return (
    <div className="rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-surface)] mb-5 overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 grid place-items-center text-[var(--color-accent)]">🛠️</div>
          <div>
            <div className="text-[14px] font-semibold">Guided PM builder</div>
            <div className="text-[12px] text-[var(--color-muted)]">Machine first — identify the asset, then generate its PM program.</div>
          </div>
        </div>
        {step > 1 && step < 6 && (
          <button onClick={reset} className="text-[12px] text-[var(--color-faint)] hover:text-[var(--color-text)]">Start over</button>
        )}
      </div>

      <div className="p-4">
        {/* progress */}
        {step < 6 && (
          <div className="flex items-center gap-1.5 mb-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className={`h-1 flex-1 rounded-full ${n <= step ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-2)]"}`} />
            ))}
          </div>
        )}

        {error && <p className="text-[12px] text-[var(--color-red)] mb-3">{error}</p>}

        {/* Step 1 — component */}
        {step === 1 && (
          <div>
            <h3 className="text-[15px] font-semibold">What are we maintaining?</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPONENTS.map((c) => (
                <button
                  key={c.label}
                  onClick={() => { setComponentLabel(c.label); setAssetType(c.assetType); setStep(2); }}
                  className="text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-2 hover:border-[var(--color-accent)]/60 hover:text-[var(--color-text)]"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — manufacturer */}
        {step === 2 && (
          <StepText
            title={`Who makes the ${componentLabel.toLowerCase()}?`}
            label="Manufacturer"
            value={manufacturer}
            onChange={setManufacturer}
            placeholder="e.g. SEW-Eurodrive, Allen-Bradley, Goulds"
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            canNext={manufacturer.trim().length > 0}
          />
        )}

        {/* Step 3 — model */}
        {step === 3 && (
          <StepText
            title="What's the model number?"
            label="Model"
            value={model}
            onChange={setModel}
            placeholder="e.g. R97 DRN100LS4"
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
            canNext={model.trim().length > 0}
          />
        )}

        {/* Step 4 — serial */}
        {step === 4 && (
          <StepText
            title="Serial number? (optional, but pins the exact machine)"
            label="Serial"
            value={serial}
            onChange={setSerial}
            placeholder="e.g. 01.1234567890.0001.18"
            onBack={() => setStep(3)}
            onNext={findMachine}
            nextLabel={resolving ? "Finding machine…" : "Find machine →"}
            canNext={!resolving}
          />
        )}

        {/* Step 5 — confirm/create the machine */}
        {step === 5 && resolution && (
          <div>
            <h3 className="text-[15px] font-semibold">Which machine is this?</h3>
            <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
              {resolution.candidates.length
                ? `Found ${resolution.candidates.length} possible machine${resolution.candidates.length > 1 ? "s" : ""}. Pick the right one, or create it.`
                : "No machine on file matched — create it so the PM has a home."}
            </p>
            <div className="mt-3 space-y-2">
              {resolution.candidates.map((c) => (
                <label key={c.asset.id} className="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] p-2.5 hover:border-[var(--color-accent)]/50">
                  <input type="radio" name="machine" checked={choice === c.asset.id} onChange={() => setChoice(c.asset.id)} className="mt-0.5" />
                  <span className="text-[13px]">
                    <span className="font-medium">{c.asset.name}</span>
                    {c.asset.assetTag && <span className="ml-2 font-mono text-[11px] text-[var(--color-faint)]">{c.asset.assetTag}</span>}
                    <span className="block text-[11px] text-[var(--color-muted)]">{Math.round(c.confidence * 100)}% · {c.why}</span>
                  </span>
                </label>
              ))}
              <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] p-2.5 hover:border-[var(--color-accent)]/50">
                <input type="radio" name="machine" checked={choice === "new"} onChange={() => setChoice("new")} className="mt-0.5" />
                <span className="text-[13px]">
                  Create new machine: <span className="font-medium">{resolution.newAssetDraft.name}</span>
                </span>
              </label>
            </div>
            {choice === "new" && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Asset number</span>
                <input
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="text-[13px] font-mono rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-1.5 outline-none focus:border-[var(--color-accent)]/60"
                />
              </div>
            )}
            <div className="flex items-center gap-2 mt-4">
              <button onClick={() => setStep(4)} className="text-[13px] rounded-lg border border-[var(--color-border)] px-3.5 py-2 hover:bg-[var(--color-surface-2)]">← Back</button>
              <button
                onClick={generate}
                disabled={generating}
                className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110 disabled:opacity-50"
              >
                {generating ? "Generating PM program…" : `Generate PM program for ${machineLine}`}
              </button>
            </div>
          </div>
        )}

        {/* Step 6 — done */}
        {step === 6 && result && (
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--color-green)]">PM program generated</h3>
            <p className="text-[12px] text-[var(--color-text)] mt-1">{result.note}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {result.cadences.map((c) => (
                <span key={c.cadenceKey} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                  {c.title.split(" PM")[0]} · {c.taskCount} tasks
                </span>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-faint)] mt-2">Each cadence is a DRAFT linked to the machine — review below and Approve to schedule.</p>
            <button onClick={reset} className="mt-3 text-[13px] font-medium rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-2 hover:border-[var(--color-accent)]/60">
              Build another
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepText({
  title, label, value, onChange, placeholder, onBack, onNext, canNext, nextLabel,
}: {
  title: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  onBack: () => void; onNext: () => void; canNext: boolean; nextLabel?: string;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <label className="block mt-3">
        <span className="text-[11px] uppercase tracking-wide text-[var(--color-faint)]">{label}</span>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canNext) onNext(); }}
          placeholder={placeholder}
          className="mt-1 w-full text-[14px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 outline-none focus:border-[var(--color-accent)]/60"
        />
      </label>
      <div className="flex items-center gap-2 mt-4">
        <button onClick={onBack} className="text-[13px] rounded-lg border border-[var(--color-border)] px-3.5 py-2 hover:bg-[var(--color-surface-2)]">← Back</button>
        <button
          onClick={onNext}
          disabled={!canNext}
          className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110 disabled:opacity-50"
        >
          {nextLabel ?? "Next →"}
        </button>
      </div>
    </div>
  );
}
