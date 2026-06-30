"use client";

// ─────────────────────────────────────────────────────────────────────────
// Assign a PM to an asset. Three paths:
//   1. Accept the AI-proposed probable match (from /api/assets/resolve)
//   2. Search & pick any existing asset
//   3. Create a NEW asset — prefilled from the PM's machine identity, with an
//      editable suggested asset number (SITE-LINE-MACHINE-###) and an optional
//      parent asset for the hierarchy.
// Posts to /api/pm/:id/assign and returns to the PM detail view.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AssetLite {
  id: string; name: string; assetTag?: string | null;
  manufacturer?: string | null; model?: string | null; serialNumber?: string | null;
  assetType?: string | null; site?: string | null; area?: string | null; line?: string | null;
}
interface Match { asset: AssetLite; confidence: number; why: string }
interface ResolveResult {
  bestMatch: Match | null;
  candidates: Match[];
  newAssetDraft: { name: string; manufacturer: string | null; model: string | null; serialNumber: string | null; assetType: string | null };
  suggestedNumber: string;
}
interface Pm { id: string; title: string; manufacturer?: string | null; model?: string | null; serialNumber?: string | null; assetType?: string | null; failureMode?: string | null }

export default function AssignPmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [pm, setPm] = useState<Pm | null>(null);
  const [resolve, setResolve] = useState<ResolveResult | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AssetLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"choose" | "create">("choose");

  // new-asset form
  const [form, setForm] = useState({
    name: "", assetTag: "", manufacturer: "", model: "", serialNumber: "",
    assetType: "", site: "", area: "", line: "", parentAssetId: "", assetLevel: "Machine",
  });

  const loadPm = useCallback(async () => {
    const r = await fetch(`/api/pm/${id}`);
    const d = await r.json();
    const p: Pm = d.program;
    setPm(p);
    // Resolve probable matches from the PM's identity.
    const rr = await fetch("/api/assets/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manufacturer: p.manufacturer ?? null,
        model: p.model ?? null,
        serialNumber: p.serialNumber ?? null,
        assetType: p.assetType ?? null,
        text: p.title ?? null,
      }),
    }).then((x) => x.json());
    setResolve(rr);
    setForm((f) => ({
      ...f,
      name: rr?.newAssetDraft?.name ?? p.title ?? "",
      manufacturer: rr?.newAssetDraft?.manufacturer ?? "",
      model: rr?.newAssetDraft?.model ?? "",
      serialNumber: rr?.newAssetDraft?.serialNumber ?? "",
      assetType: rr?.newAssetDraft?.assetType ?? "",
      assetTag: rr?.suggestedNumber ?? "",
    }));
  }, [id]);

  useEffect(() => { loadPm().catch(() => setErr("Could not load the PM.")); }, [loadPm]);

  // Live asset search.
  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/assets?search=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setResults((d.assets ?? []).slice(0, 8)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  // Re-suggest the asset number when location/type change in the create form.
  const refreshNumber = useCallback(async () => {
    const sp = new URLSearchParams();
    if (form.site) sp.set("site", form.site);
    if (form.area) sp.set("area", form.area);
    if (form.line) sp.set("line", form.line);
    if (form.assetType) sp.set("assetType", form.assetType);
    if (form.name) sp.set("name", form.name);
    if (form.model) sp.set("model", form.model);
    const r = await fetch(`/api/assets/suggest-number?${sp.toString()}`).then((x) => x.json());
    if (r?.suggestion) setForm((f) => ({ ...f, assetTag: r.suggestion }));
  }, [form.site, form.area, form.line, form.assetType, form.name, form.model]);

  const linkExisting = async (assetId: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/pm/${id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed to assign.");
      router.push(`/pm/${id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const createAndLink = async () => {
    if (!form.name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/pm/${id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createAsset: {
            name: form.name.trim(),
            assetTag: form.assetTag.trim() || null,
            manufacturer: form.manufacturer.trim() || null,
            model: form.model.trim() || null,
            serialNumber: form.serialNumber.trim() || null,
            assetType: form.assetType.trim() || null,
            site: form.site.trim() || null,
            area: form.area.trim() || null,
            line: form.line.trim() || null,
            parentAssetId: form.parentAssetId.trim() || null,
            assetLevel: form.assetLevel.trim() || null,
          },
        }),
      });
      if (!r.ok) throw new Error((await r.json()).message || "Failed to create & assign.");
      router.push(`/pm/${id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 sm:px-5 py-5">
        <Link href={`/pm/${id}`} className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]">← Back to PM</Link>
        <h1 className="mt-3 text-[18px] font-semibold tracking-tight">Assign this PM to a machine</h1>
        {pm && <p className="text-[13px] text-[var(--color-muted)] mt-0.5">{pm.title}</p>}
        {err && <p className="mt-3 text-[12px] text-[var(--color-red)]">{err}</p>}

        <div className="mt-4 inline-flex rounded-lg border border-[var(--color-border)] p-0.5 text-[12px]">
          <button onClick={() => setMode("choose")} className={`px-3 py-1.5 rounded-md ${mode === "choose" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>Use existing</button>
          <button onClick={() => { setMode("create"); refreshNumber(); }} className={`px-3 py-1.5 rounded-md ${mode === "create" ? "bg-[var(--color-surface-2)] text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>Create new</button>
        </div>

        {mode === "choose" && (
          <div className="mt-4 space-y-4">
            {/* Probable match */}
            {resolve?.bestMatch && (
              <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-3">
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-accent)] mb-1">Probable match · {Math.round(resolve.bestMatch.confidence * 100)}% confidence</div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium truncate">{resolve.bestMatch.asset.name}</div>
                    <div className="text-[12px] text-[var(--color-muted)] truncate">{resolve.bestMatch.asset.assetTag || "—"} · {resolve.bestMatch.why}</div>
                  </div>
                  <button onClick={() => linkExisting(resolve!.bestMatch!.asset.id)} disabled={busy} className="shrink-0 text-[13px] rounded-lg px-3.5 py-2 font-medium text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50">Use this</button>
                </div>
              </div>
            )}

            {/* Other candidates */}
            {resolve && resolve.candidates.length > (resolve.bestMatch ? 1 : 0) && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)] mb-1">Other possible matches</div>
                <ul className="space-y-1">
                  {resolve.candidates.filter((c) => c.asset.id !== resolve.bestMatch?.asset.id).map((c) => (
                    <li key={c.asset.id}>
                      <button onClick={() => linkExisting(c.asset.id)} disabled={busy} className="w-full flex items-center justify-between gap-2 text-left text-[13px] rounded-lg border border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-surface-2)] disabled:opacity-50">
                        <span className="truncate">{c.asset.name} <span className="text-[var(--color-faint)]">{c.asset.assetTag || ""}</span></span>
                        <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{Math.round(c.confidence * 100)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Manual search */}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--color-faint)] mb-1">Search all equipment</div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, tag, model, serial…" className="w-full text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-accent)]/60" />
              {results.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {results.map((a) => (
                    <li key={a.id}>
                      <button onClick={() => linkExisting(a.id)} disabled={busy} className="w-full flex items-center justify-between gap-2 text-left text-[13px] rounded-lg border border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-surface-2)] disabled:opacity-50">
                        <span className="truncate">{a.name} <span className="text-[var(--color-faint)]">{a.assetTag || ""}</span></span>
                        <span className="shrink-0 text-[11px] text-[var(--color-faint)]">{a.model || a.assetType || ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-[12px] text-[var(--color-faint)]">No good match? <button onClick={() => { setMode("create"); refreshNumber(); }} className="text-[var(--color-accent)] hover:underline">Create a new asset →</button></p>
          </div>
        )}

        {mode === "create" && (
          <div className="mt-4 space-y-3">
            <p className="text-[12px] text-[var(--color-muted)]">Prefilled from the PM. The suggested asset number is editable.</p>
            <Field label="Name *"><input value={form.name} onChange={set("name")} className={inp} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Asset number (editable)"><input value={form.assetTag} onChange={set("assetTag")} className={inp} /></Field>
              <Field label="Type"><input value={form.assetType} onChange={set("assetType")} onBlur={refreshNumber} placeholder="conveyor, pump…" className={inp} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Site"><input value={form.site} onChange={set("site")} onBlur={refreshNumber} className={inp} /></Field>
              <Field label="Area"><input value={form.area} onChange={set("area")} onBlur={refreshNumber} className={inp} /></Field>
              <Field label="Line"><input value={form.line} onChange={set("line")} onBlur={refreshNumber} className={inp} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Manufacturer"><input value={form.manufacturer} onChange={set("manufacturer")} className={inp} /></Field>
              <Field label="Model"><input value={form.model} onChange={set("model")} className={inp} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Serial number"><input value={form.serialNumber} onChange={set("serialNumber")} className={inp} /></Field>
              <Field label="Hierarchy level">
                <select value={form.assetLevel} onChange={set("assetLevel")} className={inp}>
                  {["Site", "Area", "Line", "Machine", "Component", "Part"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <ParentPicker value={form.parentAssetId} onChange={(v) => setForm((f) => ({ ...f, parentAssetId: v }))} />
            <div className="flex gap-2 pt-1">
              <button onClick={createAndLink} disabled={busy} className="text-[13px] rounded-lg px-4 py-2 font-medium text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50">{busy ? "Creating…" : "Create & assign"}</button>
              <button onClick={() => setMode("choose")} disabled={busy} className="text-[13px] rounded-lg px-4 py-2 border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inp = "w-full text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-accent)]/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-[var(--color-faint)] mb-1">{label}</span>
      {children}
    </label>
  );
}

// Optional parent asset for the hierarchy.
function ParentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<AssetLite[]>([]);
  const [picked, setPicked] = useState<AssetLite | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (!s) { setOpts([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/assets?search=${encodeURIComponent(s)}`).then((r) => r.json()).then((d) => setOpts((d.assets ?? []).slice(0, 6))).catch(() => setOpts([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Field label="Parent asset (optional — for hierarchy)">
      {picked ? (
        <div className="flex items-center justify-between gap-2 text-[13px] rounded-lg border border-[var(--color-border)] px-3 py-2">
          <span className="truncate">{picked.name} <span className="text-[var(--color-faint)]">{picked.assetTag || ""}</span></span>
          <button onClick={() => { setPicked(null); onChange(""); }} className="shrink-0 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]">Clear</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parent (e.g. Line A, Press cell)…" className={inp} />
          {opts.length > 0 && (
            <ul className="mt-1 space-y-1">
              {opts.map((a) => (
                <li key={a.id}>
                  <button onClick={() => { setPicked(a); onChange(a.id); setOpts([]); setQ(""); }} className="w-full text-left text-[13px] rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]">
                    {a.name} <span className="text-[var(--color-faint)]">{a.assetTag || ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Field>
  );
}
