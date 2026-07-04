"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { Markdown } from "@/components/Markdown";

const CATEGORIES = [
  { key: "machine_down", label: "Machine down" },
  { key: "watch_item", label: "Watch item" },
  { key: "safety", label: "Safety concern" },
  { key: "parts_needed", label: "Parts needed" },
  { key: "carried_over", label: "Work carried over" },
  { key: "pm_issue", label: "PM missed / deferred" },
  { key: "temp_fix", label: "Temporary fix" },
  { key: "operator_complaint", label: "Operator complaint" },
  { key: "supervisor_note", label: "Supervisor note" },
];
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

interface Note {
  id: string; category: string; note: string; priority: string; status: string;
  assetId?: string | null; assetName?: string | null; workOrderNumber?: string | null;
  followUpOwner?: string | null; createdBy?: string | null; createdAt: number;
}
interface AssetOpt { id: string; name: string }
interface Digest {
  stats: { open: number; inProgress: number; onHold: number; closedThisShift: number; pendingRequests: number; pmsDue: number };
  machinesDown: { id: string; name: string }[];
}

const priColor: Record<string, string> = {
  critical: "var(--color-red)", high: "var(--color-amber)", normal: "var(--color-muted)", low: "var(--color-faint)",
};

export default function HandoverPage() {
  const [hours, setHours] = useState(12);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesDigest, setNotesDigest] = useState("");
  const [context, setContext] = useState<Digest | null>(null);
  const [assets, setAssets] = useState<AssetOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback((h: number) => {
    setLoading(true);
    return Promise.all([
      fetch(`/api/handover/notes?hours=${h}`).then((r) => r.json()),
      fetch(`/api/handover?hours=${h}`).then((r) => r.json()),
    ]).then(([n, d]) => {
      setNotes(n.notes ?? []);
      setNotesDigest(n.digest ?? "");
      setContext(d.digest ?? null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(hours); }, [load, hours]);
  useEffect(() => {
    fetch("/api/assets").then((r) => r.json()).then((d) => setAssets((d.assets ?? []).map((a: AssetOpt) => ({ id: a.id, name: a.name })))).catch(() => {});
  }, []);

  const fullDigest = buildFullDigest(hours, notesDigest, context);
  const copy = async () => {
    try { await navigator.clipboard.writeText(fullDigest); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  const S = context?.stats;
  const openCritical = notes.filter((n) => n.status === "open" && (n.priority === "critical" || n.priority === "high"));

  return (
    <>
      <TopBar
        title="Shift Handover"
        subtitle="Enter what the next shift needs to know — the digest builds from real notes"
        right={
          <div className="flex items-center gap-2">
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="text-[12px] rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1.5">
              <option value={8}>Last 8h</option>
              <option value={12}>Last 12h</option>
              <option value={24}>Last 24h</option>
              <option value={72}>Last 3 days</option>
            </select>
            <button onClick={() => setShowForm(true)} className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110">
              + Add handover note
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-5 py-5 grid lg:grid-cols-[1fr_360px] gap-5">
          {/* Editable board */}
          <div>
            {S && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                <Stat label="Open WOs" value={S.open} />
                <Stat label="In progress" value={S.inProgress} />
                <Stat label="On hold" value={S.onHold} />
                <Stat label="Closed" value={S.closedThisShift} />
                <Stat label="Requests" value={S.pendingRequests} />
                <Stat label="PMs due" value={S.pmsDue} tone={S.pmsDue > 0 ? "amber" : undefined} />
              </div>
            )}

            {openCritical.length > 0 && (
              <div className="rounded-xl border border-[var(--color-red)]/30 bg-[var(--color-red)]/[0.06] p-3 mb-4">
                <div className="text-[12px] font-semibold text-[var(--color-red)] mb-1.5">Open critical / high items for next shift</div>
                {openCritical.map((n) => (
                  <div key={n.id} className="text-[12.5px] text-[var(--color-text)]">• {n.note}{n.assetName ? ` (${n.assetName})` : ""}</div>
                ))}
              </div>
            )}

            <h2 className="text-[13px] font-semibold mb-2 text-[var(--color-muted)] uppercase tracking-wide">Handover board</h2>
            {loading ? (
              <div className="h-24 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
            ) : notes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center">
                <p className="text-[var(--color-muted)] text-sm">No handover notes for this window yet.</p>
                <button onClick={() => setShowForm(true)} className="mt-3 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110">+ Add the first note</button>
              </div>
            ) : (
              <div className="space-y-2">
                {notes.map((n) => (
                  <NoteRow key={n.id} n={n} onChanged={() => load(hours)} />
                ))}
              </div>
            )}
          </div>

          {/* Generated digest */}
          <div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sticky top-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[13px] font-semibold">Shift digest</h2>
                <button onClick={copy} className="text-[12px] rounded-lg border border-[var(--color-border)] px-2.5 py-1 hover:bg-[var(--color-surface-2)]">
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <div className="text-[12.5px] max-h-[60vh] overflow-y-auto answer">
                <Markdown>{fullDigest}</Markdown>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showForm && (
        <AddNoteModal assets={assets} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(hours); }} />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{label}</div>
      <div className="text-[16px] font-semibold" style={tone === "amber" ? { color: "var(--color-amber)" } : undefined}>{value}</div>
    </div>
  );
}

function NoteRow({ n, onChanged }: { n: Note; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const patch = async (status: string) => {
    setBusy(true);
    await fetch(`/api/handover/notes/${n.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    onChanged();
  };
  const del = async () => {
    setBusy(true);
    await fetch(`/api/handover/notes/${n.id}`, { method: "DELETE" });
    onChanged();
  };
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${n.status === "resolved" ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">{catLabel(n.category)}</span>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: priColor[n.priority] }}>{n.priority}</span>
        {n.assetName && <span className="text-[11px] text-[var(--color-accent)]">{n.assetName}</span>}
        {n.workOrderNumber && <span className="text-[11px] text-[var(--color-faint)] font-mono">{n.workOrderNumber}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button disabled={busy} onClick={() => patch(n.status === "resolved" ? "open" : "resolved")} className="text-[11px] text-[var(--color-muted)] hover:text-[var(--color-green)]">
            {n.status === "resolved" ? "Reopen" : "Resolve"}
          </button>
          <button disabled={busy} onClick={del} className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-red)]">Delete</button>
        </div>
      </div>
      <p className="text-[13px] text-[var(--color-text)] leading-snug whitespace-pre-wrap">{n.note}</p>
      <div className="text-[10.5px] text-[var(--color-faint)] mt-1.5">
        {n.createdBy ? `${n.createdBy} · ` : ""}{new Date(n.createdAt).toLocaleString()}{n.followUpOwner ? ` · follow-up: ${n.followUpOwner}` : ""}
      </div>
    </div>
  );
}

function AddNoteModal({ assets, onClose, onSaved }: { assets: AssetOpt[]; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState("watch_item");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assetId, setAssetId] = useState("");
  const [followUpOwner, setFollowUpOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!note.trim()) { setErr("Enter a note."); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/handover/notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, note, priority, assetId: assetId || null, followUpOwner: followUpOwner || null }),
    });
    if (res.ok) onSaved();
    else { const d = await res.json().catch(() => ({})); setErr(d.message || "Could not save."); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold">Add handover note</h2>
          <button onClick={onClose} aria-label="Close" className="text-[var(--color-faint)] hover:text-[var(--color-text)] text-lg">×</button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-2 text-[13px]">
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-2 text-[13px]">
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </Field>
          </div>
          <Field label="Note">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="What does the next shift need to know?" className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-2 text-[13px] resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Link asset (optional)">
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-2 text-[13px]">
                <option value="">— General plant note —</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Follow-up owner (optional)">
              <input value={followUpOwner} onChange={(e) => setFollowUpOwner(e.target.value)} placeholder="e.g. Day-shift lead" className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-2 text-[13px]" />
            </Field>
          </div>
          {err && <p className="text-[12px] text-[var(--color-red)]">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-[13px] rounded-lg border border-[var(--color-border)] px-3.5 py-2 hover:bg-[var(--color-surface-2)]">Cancel</button>
            <button disabled={busy} onClick={save} className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110 disabled:opacity-40">
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-[var(--color-muted)] mb-1">{label}</span>
      {children}
    </label>
  );
}

function buildFullDigest(hours: number, notesDigest: string, context: Digest | null): string {
  const lines: string[] = [`## Shift Handover — last ${hours}h`];
  if (context?.stats) {
    const s = context.stats;
    lines.push(`\n**Board:** ${s.open} open · ${s.inProgress} in progress · ${s.onHold} on hold · ${s.closedThisShift} closed · ${s.pmsDue} PM(s) due`);
  }
  if (context?.machinesDown?.length) {
    lines.push(`\n**Machines down:** ${context.machinesDown.map((m) => m.name).join(", ")}`);
  }
  if (notesDigest) {
    lines.push(`\n${notesDigest}`);
  } else {
    lines.push(`\n_No handover notes entered for this window._`);
  }
  return lines.join("\n");
}
