"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { MachineFinder } from "@/components/MachineFinder";

interface Asset {
  id: string;
  name: string;
  assetTag?: string | null;
  site?: string | null;
  area?: string | null;
  line?: string | null;
  cell?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  assetType?: string | null;
  status?: string | null;
  criticality?: string | null;
}

const critColor: Record<string, string> = {
  critical: "var(--color-red)",
  high: "var(--color-amber)",
  medium: "var(--color-accent)",
  low: "var(--color-faint)",
};

const statusStyle: Record<string, { label: string; color: string; dot: string }> = {
  operational: { label: "Operational", color: "var(--color-green)", dot: "var(--color-green)" },
  degraded: { label: "Degraded", color: "var(--color-amber)", dot: "var(--color-amber)" },
  down: { label: "Down", color: "var(--color-red)", dot: "var(--color-red)" },
  maintenance: { label: "Maintenance", color: "var(--color-muted)", dot: "var(--color-muted)" },
  retired: { label: "Retired", color: "var(--color-faint)", dot: "var(--color-faint)" },
};

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [criticality, setCriticality] = useState("");
  const [assetType, setAssetType] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (criticality) params.set("criticality", criticality);
    if (assetType) params.set("assetType", assetType);
    return fetch(`/api/assets?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setAssets(d.assets ?? []))
      .catch(() => setError("We couldn't load your equipment. Please retry."))
      .finally(() => setLoading(false));
  }, [search, status, criticality, assetType]);

  // Debounce search/filter changes.
  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const types = useMemo(
    () => Array.from(new Set(assets.map((a) => a.assetType).filter(Boolean))) as string[],
    [assets]
  );

  const hasFilters = !!(search || status || criticality || assetType);

  return (
    <>
      <TopBar
        title="Assets"
        subtitle="Machine memory — each asset's history, failures, PMs, drawings, and per-asset AI"
        right={
          <button
            onClick={() => setShowForm(true)}
            className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110 transition"
          >
            + New asset
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-5 py-5">
          {/* Asset-first entry: identify the machine before anything else. */}
          <MachineFinder search={search} onSearch={setSearch} />

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="relative flex-1 min-w-[180px]">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter the list below…"
                className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] pl-9 pr-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)]"
              />
              <svg className="w-4 h-4 absolute left-3 top-2.5 text-[var(--color-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <FilterSelect value={status} onChange={setStatus} placeholder="All statuses" options={[["operational","Operational"],["degraded","Degraded"],["down","Down"],["maintenance","Maintenance"],["retired","Retired"]]} />
            <FilterSelect value={criticality} onChange={setCriticality} placeholder="All criticality" options={[["critical","Critical"],["high","High"],["medium","Medium"],["low","Low"]]} />
            {types.length > 0 && (
              <FilterSelect value={assetType} onChange={setAssetType} placeholder="All types" options={types.map((t) => [t, t] as [string, string])} />
            )}
            {hasFilters && (
              <button
                onClick={() => { setSearch(""); setStatus(""); setCriticality(""); setAssetType(""); }}
                className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)] px-2 py-2"
              >
                Clear
              </button>
            )}
          </div>

          {loading ? (
            <SkeletonGrid />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : assets.length === 0 ? (
            hasFilters ? (
              <p className="text-center text-[var(--color-muted)] text-sm py-16">
                No equipment matches these filters.
              </p>
            ) : (
              <EmptyState onCreate={() => setShowForm(true)} />
            )
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {assets.map((a) => {
                const st = statusStyle[a.status ?? "operational"] ?? statusStyle.operational;
                const loc = [a.site, a.area, a.line].filter(Boolean).join(" · ");
                return (
                  <Link
                    key={a.id}
                    href={`/assets/${a.id}`}
                    className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)] transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[14px] truncate group-hover:text-white">
                          {a.name}
                        </h3>
                        {a.assetTag && (
                          <p className="text-[11px] text-[var(--color-faint)] font-mono mt-0.5">
                            {a.assetTag}
                          </p>
                        )}
                      </div>
                      <span
                        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ color: critColor[a.criticality ?? "medium"], background: "var(--color-surface-2)" }}
                      >
                        {a.criticality ?? "medium"}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: st.color }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
                      {st.label}
                      {a.assetType && (
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{a.assetType}</span>
                      )}
                    </div>

                    <div className="mt-2 text-[12px] text-[var(--color-muted)] space-y-0.5">
                      {(a.manufacturer || a.model) && (
                        <p className="truncate">{[a.manufacturer, a.model].filter(Boolean).join(" · ")}</p>
                      )}
                      {loc && <p className="truncate">📍 {loc}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <NewAssetModal
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}
    </>
  );
}

function FilterSelect({
  value, onChange, placeholder, options,
}: {
  value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[12px] outline-none focus:border-[var(--color-accent)] capitalize"
    >
      <option value="">{placeholder}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 animate-pulse">
          <div className="h-3.5 w-2/3 rounded bg-[var(--color-surface-2)]" />
          <div className="h-2.5 w-1/3 rounded bg-[var(--color-surface-2)] mt-2" />
          <div className="h-2.5 w-1/2 rounded bg-[var(--color-surface-2)] mt-4" />
          <div className="h-2.5 w-3/4 rounded bg-[var(--color-surface-2)] mt-2" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16">
      <p className="text-[var(--color-red)] text-sm">{message}</p>
      <button onClick={onRetry} className="mt-3 text-[13px] rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">
        Retry
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-20">
      <div className="w-12 h-12 mx-auto rounded-xl bg-[var(--color-surface-2)] grid place-items-center mb-4 text-[var(--color-accent)]">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7.5 12 2 3 7.5v9L12 22l9-5.5v-9z"/></svg>
      </div>
      <h3 className="font-semibold">No equipment yet</h3>
      <p className="text-[var(--color-muted)] text-sm mt-1 max-w-sm mx-auto">
        Add your first asset to build its digital twin — nameplate, failure
        history, reliability metrics, drawings, PLC program, and a dedicated AI.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110"
      >
        + Add your first asset
      </button>
    </div>
  );
}

function NewAssetModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", assetTag: "", site: "", area: "", line: "", cell: "",
    manufacturer: "", model: "", serialNumber: "", assetType: "",
    status: "operational", criticality: "medium", installedAt: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  const submit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setErr(null);
    const body: Record<string, unknown> = { ...form };
    if (form.installedAt) body.installedAt = new Date(form.installedAt).getTime();
    else delete body.installedAt;
    try {
      const r = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message || "Create failed.");
      }
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-[15px] mb-4">New asset</h2>
        <div className="space-y-3">
          <Input label="Name *" placeholder="Line 3 Case Packer" {...field("name")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Asset tag" placeholder="CP-031" {...field("assetTag")} />
            <Select label="Type" {...field("assetType")} options={[["","—"],["conveyor","Conveyor"],["drive","Drive"],["robot","Robot"],["pump","Pump"],["press","Press"],["packaging","Packaging"],["hvac","HVAC"],["other","Other"]]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Site" placeholder="Plant A" {...field("site")} />
            <Input label="Area" placeholder="Packaging" {...field("area")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Line" placeholder="Line 3" {...field("line")} />
            <Input label="Cell / position" placeholder="Station 2" {...field("cell")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Manufacturer" placeholder="Allen-Bradley" {...field("manufacturer")} />
            <Input label="Model" placeholder="PowerFlex 525" {...field("model")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Serial number" placeholder="1P5C25A103" {...field("serialNumber")} />
            <Input label="Installed" type="date" {...field("installedAt")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Status" {...field("status")} options={[["operational","Operational"],["degraded","Degraded"],["down","Down"],["maintenance","Maintenance"],["retired","Retired"]]} />
            <Select label="Criticality" {...field("criticality")} options={[["low","Low"],["medium","Medium"],["high","High"],["critical","Critical"]]} />
          </div>
          <Textarea label="Notes" placeholder="Context a tech should know…" {...field("notes")} />
        </div>
        {err && <p className="text-[12px] text-[var(--color-red)] mt-3">{err}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button
            onClick={submit}
            disabled={!form.name.trim() || saving}
            className="text-[13px] font-medium px-4 py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 hover:brightness-110"
          >
            {saving ? "Creating…" : "Create asset"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      <input {...props} className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)]" />
    </label>
  );
}

function Textarea({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      <textarea {...props} rows={2} className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)] resize-none" />
    </label>
  );
}

function Select({ label, options, ...props }: { label: string; options: [string, string][] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      <select {...props} className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] capitalize">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
