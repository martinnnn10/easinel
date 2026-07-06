"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * First-use guided setup. Walks a brand-new owner from an empty workspace to
 * their first real asset in three short steps — site → line → machine — then
 * hands off to the two actions that make the Copilot valuable immediately
 * (upload a manual, ask a grounded question). Nothing here is fabricated: it
 * only captures what the user types and creates one real asset.
 */
export function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0 welcome, 1 site, 2 line, 3 machine, 4 done
  const [site, setSite] = useState("");
  const [line, setLine] = useState("");
  const [asset, setAsset] = useState({ name: "", manufacturer: "", model: "", criticality: "medium" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const create = async () => {
    if (!asset.name.trim() || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: asset.name.trim(),
          manufacturer: asset.manufacturer.trim() || undefined,
          model: asset.model.trim() || undefined,
          criticality: asset.criticality,
          site: site.trim() || undefined,
          line: line.trim() || undefined,
          status: "operational",
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message || "Couldn't create the asset.");
      }
      const d = await r.json();
      setCreatedId(d.asset?.id ?? null);
      setStep(4);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const askQuery = (() => {
    const bits = [asset.manufacturer, asset.model].filter(Boolean).join(" ");
    const subject = bits || asset.name || "this machine";
    return `What are the most common faults on a ${subject}, and what should I check first?`;
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 fadeup">
        {/* Progress */}
        {step > 0 && step < 4 && (
          <div className="flex items-center gap-1.5 mb-5">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className="h-1 flex-1 rounded-full transition-colors"
                style={{ background: n <= step ? "var(--color-accent)" : "var(--color-surface-2)" }}
              />
            ))}
          </div>
        )}

        {step === 0 && (
          <div>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-white font-bold shadow-lg shadow-black/40 mb-4">E</div>
            <h2 className="text-[19px] font-semibold">Let&apos;s set up your plant</h2>
            <p className="text-[13.5px] text-[var(--color-muted)] mt-2 leading-relaxed">
              Three quick steps and your first machine has a home. From there, every
              breakdown you close makes the Copilot smarter about <em>your</em> equipment.
            </p>
            <p className="text-[12px] text-[var(--color-faint)] mt-3">Takes about two minutes.</p>
            <div className="flex justify-between items-center mt-6">
              <button onClick={onClose} className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-text)]">
                I&apos;ll explore on my own
              </button>
              <button onClick={() => setStep(1)} className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-5 py-2 hover:brightness-110">
                Start
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <StepShell
            title="Which site or plant?"
            hint="The physical location this equipment lives in. You can add more later."
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            nextLabel="Next"
          >
            <WizInput autoFocus value={site} onChange={setSite} placeholder="e.g. Plant A — Fort Worth" onEnter={() => setStep(2)} />
            <SkipHint onSkip={() => setStep(2)} />
          </StepShell>
        )}

        {step === 2 && (
          <StepShell
            title="Which line or area?"
            hint="The production line or area within the site — e.g. Packaging, Line 3."
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextLabel="Next"
          >
            <WizInput autoFocus value={line} onChange={setLine} placeholder="e.g. Line 3 — Case Packing" onEnter={() => setStep(3)} />
            <SkipHint onSkip={() => setStep(3)} />
          </StepShell>
        )}

        {step === 3 && (
          <StepShell
            title="Add your first machine"
            hint="Name it, and add the make/model so the Copilot can ground answers in the right manuals."
            onBack={() => setStep(2)}
            onNext={create}
            nextLabel={saving ? "Creating…" : "Create machine"}
            nextDisabled={!asset.name.trim() || saving}
          >
            <WizInput autoFocus value={asset.name} onChange={(v) => setAsset((a) => ({ ...a, name: v }))} placeholder="Machine name — e.g. Line 3 Case Packer" />
            <div className="grid grid-cols-2 gap-2.5 mt-2.5">
              <WizInput value={asset.manufacturer} onChange={(v) => setAsset((a) => ({ ...a, manufacturer: v }))} placeholder="Make — Allen-Bradley" small />
              <WizInput value={asset.model} onChange={(v) => setAsset((a) => ({ ...a, model: v }))} placeholder="Model — PowerFlex 525" small />
            </div>
            <label className="block mt-2.5">
              <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">How critical is it?</span>
              <select
                value={asset.criticality}
                onChange={(e) => setAsset((a) => ({ ...a, criticality: e.target.value }))}
                className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] capitalize"
              >
                <option value="low">Low — redundant / non-critical</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical — line stops if it stops</option>
              </select>
            </label>
            {err && <p className="text-[12px] text-[var(--color-red)] mt-2.5">{err}</p>}
          </StepShell>
        )}

        {step === 4 && (
          <div>
            <div className="w-11 h-11 rounded-xl bg-[var(--color-green)]/15 grid place-items-center text-[var(--color-green)] mb-4">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <h2 className="text-[19px] font-semibold">{asset.name || "Your machine"} is live</h2>
            <p className="text-[13.5px] text-[var(--color-muted)] mt-2 leading-relaxed">
              It now has a home for its history, failures, PMs, and a dedicated AI. Do one
              of these next to make the Copilot immediately useful:
            </p>
            <div className="mt-4 space-y-2.5">
              <NextAction
                title="Upload its manual or drawing"
                body="The Copilot will cite your document by page when this machine acts up."
                onClick={() => router.push(createdId ? `/assets/${createdId}?upload=1` : "/knowledge")}
              />
              <NextAction
                title="Ask the Copilot about it"
                body="Get a grounded answer right now — even before you upload anything."
                onClick={() => router.push(`/copilot?ask=${encodeURIComponent(askQuery)}`)}
              />
              <NextAction
                title="View the machine"
                body="See its digital twin and start logging work."
                onClick={() => router.push(createdId ? `/assets/${createdId}` : "/assets")}
              />
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={onClose} className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-text)]">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepShell({
  title, hint, children, onBack, onNext, nextLabel, nextDisabled,
}: {
  title: string; hint: string; children: React.ReactNode;
  onBack: () => void; onNext: () => void; nextLabel: string; nextDisabled?: boolean;
}) {
  return (
    <div>
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="text-[12.5px] text-[var(--color-muted)] mt-1 leading-snug">{hint}</p>
      <div className="mt-4">{children}</div>
      <div className="flex justify-between items-center mt-6">
        <button onClick={onBack} className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-text)]">Back</button>
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-5 py-2 disabled:opacity-40 hover:brightness-110"
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function WizInput({
  value, onChange, placeholder, autoFocus, small, onEnter,
}: {
  value: string; onChange: (v: string) => void; placeholder: string;
  autoFocus?: boolean; small?: boolean; onEnter?: () => void;
}) {
  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      placeholder={placeholder}
      className={`w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 ${small ? "py-2 text-[12.5px]" : "py-2.5 text-[14px]"} outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)]`}
    />
  );
}

function SkipHint({ onSkip }: { onSkip: () => void }) {
  return (
    <button onClick={onSkip} className="text-[11.5px] text-[var(--color-faint)] hover:text-[var(--color-muted)] mt-2">
      Not sure yet — skip for now
    </button>
  );
}

function NextAction({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/40 p-3.5 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)] transition"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium">{title}</p>
        <span className="text-[var(--color-faint)]">→</span>
      </div>
      <p className="text-[11.5px] text-[var(--color-muted)] mt-0.5 leading-snug">{body}</p>
    </button>
  );
}
