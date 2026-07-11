"use client";

import { useEffect, useState, useCallback } from "react";

// Root Cause Analysis panel for a corrective work order. Progressive disclosure
// so a close-out never feels like paperwork hell: a compact repair recap, the
// RCA form (with an optional 5-Why), and — only after the RCA is saved — the
// "prevent this failure" PM prompt. AI can DRAFT but never confirm; a manager
// confirms the root cause; a PM born here is always a draft. All enforcement is
// server-side — this UI only mirrors it.

type RcaStatus = "draft" | "technician_completed" | "manager_confirmed";
interface Rca {
  id: string;
  status: RcaStatus;
  problemStatement: string | null;
  symptomObserved: string | null;
  failedPart: string | null;
  suspectedCause: string | null;
  confirmedRootCause: string | null;
  why1: string | null; why2: string | null; why3: string | null; why4: string | null; why5: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  verificationMethod: string | null;
  repeatFailure: string | null;
  aiSuggested: boolean;
  approvedBy: string | null;
}

type Fields = Omit<Rca, "id" | "status" | "aiSuggested" | "approvedBy">;
const EMPTY: Fields = {
  problemStatement: "", symptomObserved: "", failedPart: "", suspectedCause: "", confirmedRootCause: "",
  why1: "", why2: "", why3: "", why4: "", why5: "", correctiveAction: "", preventiveAction: "",
  verificationMethod: "", repeatFailure: "unknown",
};

const WHY_PH = [
  "Why did the drive fault? — e.g. motor current spiked during acceleration",
  "Why did that happen? — e.g. the belt was overloaded",
  "Why was it overloaded? — e.g. product was backing up at the discharge",
  "Why was product backing up? — e.g. the discharge photoeye was dirty/misaligned",
  "Why wasn't it caught earlier? — e.g. the PM didn't include photoeye cleaning",
];

export function RcaPanel({
  workOrderId,
  assetId,
  downtimeMins,
  woType,
}: {
  workOrderId: string;
  assetId: string | null;
  downtimeMins: number | null;
  woType: string;
}) {
  const [rca, setRca] = useState<Rca | null>(null);
  const [f, setF] = useState<Fields>(EMPTY);
  const [canManagePm, setCanManagePm] = useState(false);
  const [open, setOpen] = useState(false);
  const [showWhys, setShowWhys] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "draft" | "save" | "confirm">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pmPrompt, setPmPrompt] = useState(false);
  const [pmResult, setPmResult] = useState<{ kind: "ok" | "err"; text: string; pmId?: string } | null>(null);

  const hydrate = (r: Rca | null) => {
    if (!r) return;
    setRca(r);
    setF({
      problemStatement: r.problemStatement ?? "", symptomObserved: r.symptomObserved ?? "", failedPart: r.failedPart ?? "",
      suspectedCause: r.suspectedCause ?? "", confirmedRootCause: r.confirmedRootCause ?? "",
      why1: r.why1 ?? "", why2: r.why2 ?? "", why3: r.why3 ?? "", why4: r.why4 ?? "", why5: r.why5 ?? "",
      correctiveAction: r.correctiveAction ?? "", preventiveAction: r.preventiveAction ?? "",
      verificationMethod: r.verificationMethod ?? "", repeatFailure: r.repeatFailure ?? "unknown",
    });
    if (r.why1 || r.why2 || r.why3) setShowWhys(true);
  };

  const load = useCallback(() => {
    fetch(`/api/work-orders/${workOrderId}/rca`).then((r) => r.json()).then((d) => hydrate(d.rca)).catch(() => {});
  }, [workOrderId]);

  useEffect(() => {
    load();
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      const role = d?.user?.role;
      setCanManagePm(role === "owner" || role === "admin" || role === "manager");
    }).catch(() => {});
  }, [load]);

  if (woType !== "corrective") return null;

  const rcaNeeded = Boolean(downtimeMins && downtimeMins > 0) && (!rca || rca.status === "draft");
  const set = (k: keyof Fields, v: string) => setF((p) => ({ ...p, [k]: v }));

  const draft = async () => {
    setBusy("draft"); setMsg(null);
    try {
      const r = await fetch(`/api/work-orders/${workOrderId}/rca/draft`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || "Couldn't draft");
      const dr = d.draft;
      // Fill only EMPTY fields — never overwrite what the tech already typed.
      setF((p) => ({
        ...p,
        problemStatement: p.problemStatement || dr.problemStatement || "",
        symptomObserved: p.symptomObserved || dr.symptomObserved || "",
        failedPart: p.failedPart || dr.failedPart || "",
        suspectedCause: p.suspectedCause || dr.suspectedCause || "",
        correctiveAction: p.correctiveAction || dr.correctiveAction || "",
        preventiveAction: p.preventiveAction || dr.preventiveAction || "",
        verificationMethod: p.verificationMethod || dr.verificationMethod || "",
      }));
      setAiNote(dr.note || dr.label);
      setOpen(true);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(null); }
  };

  const persist = async (status: RcaStatus) => {
    setBusy(status === "manager_confirmed" ? "confirm" : "save"); setMsg(null);
    try {
      const payload: Record<string, unknown> = { ...f, status, aiSuggested: Boolean(aiNote) };
      if (!canManagePm) delete payload.confirmedRootCause; // server enforces too
      const r = await fetch(`/api/work-orders/${workOrderId}/rca`, {
        method: rca ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || "Couldn't save");
      hydrate(d.rca);
      setAiNote(null);
      setMsg({ kind: "ok", text: status === "manager_confirmed" ? "Root cause confirmed." : "RCA saved." });
      setPmPrompt(true);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally { setBusy(null); }
  };

  const createPm = async () => {
    setPmResult(null);
    try {
      const r = await fetch(`/api/work-orders/${workOrderId}/suggest-pm-from-rca`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setPmResult({ kind: "err", text: d.message || "Couldn't draft a PM." }); return; }
      setPmResult({ kind: "ok", text: "PM drafted — review and approve.", pmId: d.program?.id });
    } catch {
      setPmResult({ kind: "err", text: "Couldn't draft a PM." });
    }
  };

  const statusPill = () => {
    if (!rca) return null;
    const map: Record<RcaStatus, { t: string; c: string }> = {
      draft: { t: "Draft", c: "text-[var(--color-muted)] bg-[var(--color-surface-2)]" },
      technician_completed: { t: "Tech completed", c: "text-[var(--color-info)] bg-[var(--color-info-soft)]" },
      manager_confirmed: { t: "Root cause confirmed", c: "text-[var(--color-green)] bg-[var(--color-accent-soft)]" },
    };
    const s = map[rca.status];
    return <span className={`text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${s.c}`}>{s.t}</span>;
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="text-lg">🧭</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold flex items-center gap-2">
            Root Cause Analysis
            {statusPill()}
            {rcaNeeded && <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 text-[var(--color-amber)] bg-[color-mix(in_srgb,var(--color-amber)_14%,transparent)]">RCA needed</span>}
          </h3>
          <p className="text-[11.5px] text-[var(--color-faint)] mt-0.5">
            What caused this, what did we do, and should we prevent it — grounded in recorded data.
          </p>
        </div>
        <span className={`text-[var(--color-faint)] transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-[var(--color-border-soft)] pt-4 space-y-4">
          {/* 1 · Repair Closeout recap */}
          <Section n="1" title="Repair Closeout">
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Symptom observed"><input className={inp} value={f.symptomObserved ?? ""} onChange={(e) => set("symptomObserved", e.target.value)} /></Field>
              <Field label="Failed part"><input className={inp} value={f.failedPart ?? ""} onChange={(e) => set("failedPart", e.target.value)} /></Field>
            </div>
          </Section>

          {/* 2 · Root Cause Analysis */}
          <Section n="2" title="Root Cause Analysis">
            {aiNote && (
              <div className="rounded-lg border border-[var(--color-amber)]/40 bg-[color-mix(in_srgb,var(--color-amber)_10%,transparent)] px-3 py-2 text-[11.5px] text-[var(--color-amber)] mb-2">
                {aiNote}
              </div>
            )}
            <Field label="Problem statement"><textarea rows={2} className={inp} value={f.problemStatement ?? ""} onChange={(e) => set("problemStatement", e.target.value)} placeholder="Wrapper VFD faulted on overcurrent during startup." /></Field>
            <Field label="Suspected cause"><input className={inp} value={f.suspectedCause ?? ""} onChange={(e) => set("suspectedCause", e.target.value)} placeholder="What you think caused it (not yet confirmed)" /></Field>
            <Field label={canManagePm ? "Confirmed root cause (manager)" : "Confirmed root cause — a manager confirms this"}>
              <input
                className={`${inp} ${!canManagePm ? "opacity-60 cursor-not-allowed" : ""}`}
                value={f.confirmedRootCause ?? ""}
                disabled={!canManagePm}
                onChange={(e) => set("confirmedRootCause", e.target.value)}
                placeholder={canManagePm ? "The verified root cause" : "Only a manager/admin can confirm"}
              />
            </Field>

            <button onClick={() => setShowWhys((s) => !s)} className="text-[11.5px] font-medium text-[var(--color-accent)] hover:underline">
              {showWhys ? "Hide 5 Whys" : "Add 5 Whys (optional)"}
            </button>
            {showWhys && (
              <div className="space-y-1.5 mt-1">
                {([f.why1, f.why2, f.why3, f.why4, f.why5]).map((v, i) => (
                  <input key={i} className={inp} value={v ?? ""} placeholder={WHY_PH[i]} onChange={(e) => set(`why${i + 1}` as keyof Fields, e.target.value)} />
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11.5px] text-[var(--color-muted)]">Repeat failure?</span>
              <select className={`${inp} w-auto`} value={f.repeatFailure ?? "unknown"} onChange={(e) => set("repeatFailure", e.target.value)}>
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </Section>

          {/* 3 · Prevent this failure */}
          <Section n="3" title="Prevent This Failure">
            <Field label="Corrective action (done)"><textarea rows={2} className={inp} value={f.correctiveAction ?? ""} onChange={(e) => set("correctiveAction", e.target.value)} placeholder="What was done to fix it" /></Field>
            <Field label="Preventive action (proposed)"><textarea rows={2} className={inp} value={f.preventiveAction ?? ""} onChange={(e) => set("preventiveAction", e.target.value)} placeholder="e.g. add photoeye cleaning/alignment to the PM route" /></Field>
            <Field label="Verification method"><input className={inp} value={f.verificationMethod ?? ""} onChange={(e) => set("verificationMethod", e.target.value)} placeholder="How you confirmed the fix held" /></Field>
          </Section>

          {msg && <p className={`text-[12px] ${msg.kind === "err" ? "text-[var(--color-red)]" : "text-[var(--color-green)]"}`}>{msg.text}</p>}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={draft} disabled={busy !== null} className="text-[12px] font-medium rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)] disabled:opacity-50">
              {busy === "draft" ? "Drafting…" : "✨ Help me draft RCA"}
            </button>
            <button onClick={() => persist("technician_completed")} disabled={busy !== null} className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-3 py-1.5 hover:brightness-110 disabled:opacity-50">
              {busy === "save" ? "Saving…" : "Save RCA"}
            </button>
            {canManagePm && (
              <button onClick={() => persist("manager_confirmed")} disabled={busy !== null || !f.confirmedRootCause?.trim()} className="text-[12px] font-medium rounded-lg border border-[var(--color-green)]/50 text-[var(--color-green)] px-3 py-1.5 hover:bg-[var(--color-accent-soft)] disabled:opacity-40" title={!f.confirmedRootCause?.trim() ? "Enter the confirmed root cause first" : ""}>
                {busy === "confirm" ? "Confirming…" : "Confirm root cause"}
              </button>
            )}
          </div>

          {/* PM-from-RCA prompt (only after a save) */}
          {pmPrompt && rca && rca.status !== "draft" && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 mt-1">
              <p className="text-[12.5px] font-medium">Should EAS create a PM draft to prevent this from happening again?</p>
              {pmResult ? (
                <p className={`text-[12px] mt-1.5 ${pmResult.kind === "err" ? "text-[var(--color-amber)]" : "text-[var(--color-green)]"}`}>
                  {pmResult.text}{" "}
                  {pmResult.pmId && <a href={`/pm/${pmResult.pmId}`} className="underline font-medium">Review draft →</a>}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {assetId ? (
                    <button onClick={createPm} className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-3 py-1.5 hover:brightness-110">Create PM draft</button>
                  ) : (
                    <span className="text-[11.5px] text-[var(--color-amber)]">Link a machine to this work order to draft a PM.</span>
                  )}
                  <button onClick={() => setPmPrompt(false)} className="text-[12px] rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]">Not needed</button>
                  <button onClick={() => setPmPrompt(false)} className="text-[12px] text-[var(--color-faint)] px-2 py-1.5 hover:text-[var(--color-muted)]">Decide later</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inp = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-medium uppercase tracking-wide text-[var(--color-faint)] mb-1">{label}</span>
      {children}
    </label>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] grid place-items-center text-[10px] font-bold">{n}</span>
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{title}</h4>
      </div>
      <div className="space-y-2 pl-7">{children}</div>
    </div>
  );
}
