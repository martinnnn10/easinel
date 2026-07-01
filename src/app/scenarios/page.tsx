"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface Scenario {
  id: string;
  title: string;
  assetId?: string | null;
  location?: string | null;
  machineType?: string | null;
  symptom?: string | null;
  faultCode?: string | null;
  operatingCondition?: string | null;
  safetyCondition?: string | null;
  knownHistory?: string | null;
  expectedDiagnosticPath?: string | null;
  actualRootCause?: string | null;
  correctiveAction?: string | null;
  lessonLearned?: string | null;
  skillLevel?: string | null;
  tags?: string | null;
  status: string;
  updatedAt?: number;
}
interface AssetOpt { id: string; name: string; assetTag?: string | null }

const SKILLS = ["", "apprentice", "junior", "mid", "senior", "lead"];
const statusColor: Record<string, string> = {
  complete: "var(--color-green)",
  draft: "var(--color-amber)",
  archived: "var(--color-faint)",
};

export default function ScenariosPage() {
  const [items, setItems] = useState<Scenario[]>([]);
  const [assets, setAssets] = useState<AssetOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Scenario | "new" | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetch("/api/scenarios")
      .then((r) => r.json())
      .then((d) => setItems(d.scenarios ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/assets").then((r) => r.json()).then((d) => setAssets(d.assets ?? [])).catch(() => {});
  }, [load]);

  const assetName = (id?: string | null) => assets.find((a) => a.id === id)?.name;

  return (
    <>
      <TopBar
        title="Scenarios"
        subtitle="Your plant's real troubleshooting & training cases"
        right={
          <button
            onClick={() => setEditing("new")}
            className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110"
          >
            + New scenario
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
              <p className="text-[15px] font-medium">No scenarios yet</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">
                Capture a real troubleshooting case from your plant — a symptom, the
                diagnostic path, the root cause, and the lesson. Nothing here is
                pre-filled; every scenario is one your team created.
              </p>
              <button onClick={() => setEditing("new")} className="mt-4 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110">
                Create your first scenario
              </button>
            </div>
          ) : (
            <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
              {items.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setEditing(s)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--color-surface-2)] ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}
                >
                  <span className="w-1.5 h-9 rounded-full shrink-0" style={{ background: statusColor[s.status] ?? "var(--color-faint)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium truncate">{s.title}</p>
                    <p className="text-[11.5px] text-[var(--color-faint)] truncate">
                      {s.assetId ? (assetName(s.assetId) ?? "Linked machine") : "⚠ Unassigned draft"}
                      {s.faultCode ? ` · ${s.faultCode}` : ""}
                      {s.machineType ? ` · ${s.machineType}` : ""}
                    </p>
                  </div>
                  <span
                    className="text-[10px] uppercase px-2 py-0.5 rounded-full font-medium"
                    style={{ color: statusColor[s.status], background: `color-mix(in srgb, ${statusColor[s.status]} 14%, transparent)` }}
                  >
                    {s.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <ScenarioBuilder
          initial={editing === "new" ? null : editing}
          assets={assets}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function ScenarioBuilder({
  initial,
  assets,
  onClose,
  onSaved,
}: {
  initial: Scenario | null;
  assets: AssetOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>(() => ({
    title: initial?.title ?? "",
    assetId: initial?.assetId ?? "",
    location: initial?.location ?? "",
    machineType: initial?.machineType ?? "",
    symptom: initial?.symptom ?? "",
    faultCode: initial?.faultCode ?? "",
    operatingCondition: initial?.operatingCondition ?? "",
    safetyCondition: initial?.safetyCondition ?? "",
    knownHistory: initial?.knownHistory ?? "",
    expectedDiagnosticPath: initial?.expectedDiagnosticPath ?? "",
    actualRootCause: initial?.actualRootCause ?? "",
    correctiveAction: initial?.correctiveAction ?? "",
    lessonLearned: initial?.lessonLearned ?? "",
    skillLevel: initial?.skillLevel ?? "",
    tags: initial?.tags ? (JSON.parse(initial.tags) as string[]).join(", ") : "",
    status: initial?.status ?? "draft",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const noAsset = !f.assetId;

  const save = async (markComplete: boolean) => {
    if (!f.title.trim() && !f.symptom.trim()) { setErr("Add a title or a symptom."); return; }
    setBusy(true); setErr(null);
    const body = {
      ...f,
      assetId: f.assetId || null,
      skillLevel: f.skillLevel || null,
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      status: markComplete ? "complete" : (initial?.status === "archived" ? "archived" : "draft"),
    };
    try {
      const url = initial ? `/api/scenarios/${initial.id}` : "/api/scenarios";
      const method = initial ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || `Save failed (${r.status})`); }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!initial) return;
    if (!confirm("Delete this scenario? This cannot be undone.")) return;
    setBusy(true);
    await fetch(`/api/scenarios/${initial.id}`, { method: "DELETE" });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end" onClick={() => !busy && onClose()}>
      <div className="w-full sm:max-w-xl h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-y-auto fadeup" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Scenario builder">
        <div className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-5 py-4 flex items-center gap-3 z-10">
          <h2 className="text-[15px] font-semibold flex-1">{initial ? "Edit scenario" : "New scenario"}</h2>
          <button onClick={() => !busy && onClose()} aria-label="Close" className="text-[var(--color-faint)] hover:text-[var(--color-text)] text-lg">×</button>
        </div>

        <div className="px-5 py-4 space-y-3.5">
          {/* Asset-first prompt */}
          <Field label="Which machine does this scenario belong to?">
            <select value={f.assetId} onChange={(e) => set("assetId")(e.target.value)} className={inp}>
              <option value="">— No asset (Unassigned draft) —</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.assetTag ? ` [${a.assetTag}]` : ""}</option>)}
            </select>
          </Field>
          {noAsset && (
            <div className="rounded-lg border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/10 px-3 py-2 text-[12px] text-[var(--color-amber)]">
              ⚠ Without a machine this stays an <strong>Unassigned draft</strong> and can’t be marked complete.{" "}
              <Link href="/assets" className="underline">Create a machine</Link> to attach it.
            </div>
          )}

          <Field label="Scenario title"><input value={f.title} onChange={(e) => set("title")(e.target.value)} placeholder="e.g. Packer trips overload ~20 min after cold start" className={inp} /></Field>
          <Field label="Symptom (what the technician sees)"><textarea value={f.symptom} onChange={(e) => set("symptom")(e.target.value)} rows={2} className={inp} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fault code"><input value={f.faultCode} onChange={(e) => set("faultCode")(e.target.value)} placeholder="F007" className={inp} /></Field>
            <Field label="Machine type"><input value={f.machineType} onChange={(e) => set("machineType")(e.target.value)} placeholder="conveyor, pump…" className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location"><input value={f.location} onChange={(e) => set("location")(e.target.value)} placeholder="Packaging / Line 2" className={inp} /></Field>
            <Field label="Skill level">
              <select value={f.skillLevel} onChange={(e) => set("skillLevel")(e.target.value)} className={inp}>
                {SKILLS.map((s) => <option key={s} value={s}>{s || "—"}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Operating condition"><input value={f.operatingCondition} onChange={(e) => set("operatingCondition")(e.target.value)} placeholder="running under load / cold start…" className={inp} /></Field>
          <Field label="Safety condition"><input value={f.safetyCondition} onChange={(e) => set("safetyCondition")(e.target.value)} placeholder="LOTO required; DC bus holds voltage…" className={inp} /></Field>
          <Field label="Known history"><textarea value={f.knownHistory} onChange={(e) => set("knownHistory")(e.target.value)} rows={2} className={inp} /></Field>
          <Field label="Expected diagnostic path"><textarea value={f.expectedDiagnosticPath} onChange={(e) => set("expectedDiagnosticPath")(e.target.value)} rows={3} placeholder="Step 1 → Step 2 → …" className={inp} /></Field>
          <Field label="Actual root cause"><textarea value={f.actualRootCause} onChange={(e) => set("actualRootCause")(e.target.value)} rows={2} className={inp} /></Field>
          <Field label="Corrective action"><textarea value={f.correctiveAction} onChange={(e) => set("correctiveAction")(e.target.value)} rows={2} className={inp} /></Field>
          <Field label="Lesson learned"><textarea value={f.lessonLearned} onChange={(e) => set("lessonLearned")(e.target.value)} rows={2} className={inp} /></Field>
          <Field label="Tags (comma-separated)"><input value={f.tags} onChange={(e) => set("tags")(e.target.value)} placeholder="thermal, overload, bearing" className={inp} /></Field>

          {err && <p className="text-[12px] text-[var(--color-red)]" role="alert">{err}</p>}
        </div>

        <div className="sticky bottom-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] px-5 py-3 flex items-center gap-2">
          {initial && <button onClick={remove} disabled={busy} className="text-[12.5px] text-[var(--color-red)] hover:underline mr-auto disabled:opacity-40">Delete</button>}
          <button onClick={() => !busy && onClose()} className="text-[13px] px-3 py-2 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button onClick={() => save(false)} disabled={busy} className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-40">
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button onClick={() => save(true)} disabled={busy || noAsset} title={noAsset ? "Attach a machine first" : undefined} className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[var(--color-green)] text-white hover:brightness-110 disabled:opacity-40">
            Save as complete
          </button>
        </div>
      </div>
    </div>
  );
}

const inp =
  "w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
