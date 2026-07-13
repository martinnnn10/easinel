"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

interface Part {
  id: string;
  description: string;
  partNumber: string | null;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  category: string | null;
  replacementNotes: string | null;
  criticalSpare: boolean;
  preferredSupplier: string | null;
  supplierUrl: string | null;
  manufacturerUrl: string | null;
  estLeadTime: string | null;
  estPrice: string | null;
  stockQty: number | null;
  reorderPoint: number | null;
  alternatePartNumbers: string | null;
  status: string;
}
interface Memory {
  part: Part;
  aliases: { id: string; alias: string; kind: string }[];
  assets: { assetId: string; name: string | null; position: string | null }[];
  workOrders: { workOrderId: string; number: string | null; title: string; role: string; status: string; closedAt: number | null; downtimeMins: number | null; assignedTo: string | null }[];
  pms: { pmProgramId: string; title: string; status: string }[];
  failure: { failureCount: number; lastFailedAt: number | null; avgDowntimeMins: number | null; replacedBy: string[] };
  suppliers: { id: string; name: string; url: string | null; leadTime: string | null; price: string | null; notes: string | null }[];
}

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

export default function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [m, setM] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/parts/${id}/usage`);
      if (res.status === 404) throw new Error("Part not found");
      if (!res.ok) throw new Error("Failed to load part");
      setM((await res.json()).memory);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <>
        <TopBar title="Part" subtitle="Loading…" />
        <div className="flex-1 overflow-y-auto"><div className="max-w-4xl mx-auto px-5 py-6 space-y-3">
          {[0,1,2,3].map((i) => <div key={i} className="h-24 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />)}
        </div></div>
      </>
    );
  }
  if (error || !m) {
    return (
      <>
        <TopBar title="Part" subtitle="Not found" />
        <div className="grid place-items-center h-full text-center">
          <div>
            <p className="text-[var(--color-muted)]">{error || "Part not found."}</p>
            <Link href="/parts" className="text-[var(--color-accent)] text-sm">← Back to Parts</Link>
          </div>
        </div>
      </>
    );
  }

  const p = m.part;

  return (
    <>
      <TopBar
        title={p.description}
        subtitle={[p.manufacturer, p.partNumber || p.manufacturerPartNumber, p.category].filter(Boolean).join(" · ") || "Part"}
        right={
          <button onClick={() => router.push("/parts")} className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]">
            ← Parts
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6 space-y-5">
          {/* Header chips */}
          <div className="flex flex-wrap items-center gap-2">
            {p.criticalSpare && <Chip color="var(--color-amber)">★ Critical spare</Chip>}
            <Chip color={p.status === "obsolete" ? "var(--color-red)" : "var(--color-green)"}>{p.status}</Chip>
            {m.failure.failureCount > 0 && <Chip color="var(--color-red)">{m.failure.failureCount} failure{m.failure.failureCount > 1 ? "s" : ""} on record</Chip>}
          </div>

          {/* Field Memory grid */}
          <Section title="Field Memory">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <Stat label="Times failed" value={String(m.failure.failureCount)} />
              <Stat label="Last failed" value={fmtDate(m.failure.lastFailedAt)} />
              <Stat label="Avg downtime" value={m.failure.avgDowntimeMins != null ? `${m.failure.avgDowntimeMins} min` : "—"} />
              <Stat label="Used on" value={`${m.assets.length} asset${m.assets.length === 1 ? "" : "s"}`} />
            </div>
            {m.failure.replacedBy.length > 0 && (
              <p className="text-[12px] text-[var(--color-muted)] mt-3">
                Previously replaced by: <span className="text-[var(--color-text)]">{m.failure.replacedBy.join(", ")}</span>
              </p>
            )}
          </Section>

          {/* Where used */}
          <Section title={`Used on these machines (${m.assets.length})`}>
            {m.assets.length === 0 ? (
              <Empty>Not yet linked to any asset. Link it from a work order or the asset profile.</Empty>
            ) : (
              <div className="space-y-1">
                {m.assets.map((a) => (
                  <Link key={a.assetId} href={`/assets/${a.assetId}`} className="flex items-center gap-2 text-[13px] rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                    <span>🏭</span>
                    <span className="flex-1 truncate">{a.name ?? a.assetId}</span>
                    {a.position && <span className="text-[11px] text-[var(--color-faint)]">{a.position}</span>}
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* Failure history (work orders) */}
          <Section title={`Work order history (${m.workOrders.length})`}>
            {m.workOrders.length === 0 ? (
              <Empty>No work orders reference this part yet.</Empty>
            ) : (
              <div className="space-y-1">
                {m.workOrders.map((w) => (
                  <Link key={w.workOrderId} href={`/work-orders/${w.workOrderId}`} className="flex items-center gap-2 text-[13px] rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                    <span className="font-mono text-[10px] text-[var(--color-faint)]">{w.number}</span>
                    <span className="flex-1 truncate">{w.title}</span>
                    {w.role === "failed" && <Chip color="var(--color-red)" small>failed</Chip>}
                    <span className="text-[11px] text-[var(--color-faint)]">{fmtDate(w.closedAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* PMs that inspect it */}
          <Section title={`Inspected by PMs (${m.pms.length})`}>
            {m.pms.length === 0 ? (
              <Empty>No preventive maintenance inspects this part yet.</Empty>
            ) : (
              <div className="space-y-1">
                {m.pms.map((pm) => (
                  <Link key={pm.pmProgramId} href={`/pm/${pm.pmProgramId}`} className="flex items-center gap-2 text-[13px] rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                    <span>📅</span><span className="flex-1 truncate">{pm.title}</span>
                    <span className="text-[10px] uppercase text-[var(--color-faint)]">{pm.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* Replacement notes (human free-text) */}
          <ReplacementNotes partId={id} initial={p.replacementNotes ?? ""} onSaved={load} />

          {/* Aliases */}
          <Aliases partId={id} aliases={m.aliases} onChanged={load} />

          {/* Sourcing (Phase 5 — honest) */}
          <Sourcing partId={id} part={p} suppliers={m.suppliers} onChanged={load} />
        </div>
      </div>
    </>
  );
}

function ReplacementNotes({ partId, initial, onSaved }: { partId: string; initial: string; onSaved: () => void }) {
  const [val, setVal] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = val !== initial;
  return (
    <Section title="Common replacement mistakes (team notes)">
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        rows={3}
        placeholder="e.g. Easy to install the seal backwards — the lip faces the gearbox. Torque the cap to 24 Nm, not more."
        className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] resize-none"
      />
      {dirty && (
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await fetch(`/api/parts/${partId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ replacementNotes: val }) });
            setSaving(false);
            onSaved();
          }}
          className="mt-2 text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save notes"}
        </button>
      )}
    </Section>
  );
}

function Aliases({ partId, aliases, onChanged }: { partId: string; aliases: { id: string; alias: string; kind: string }[]; onChanged: () => void }) {
  const [val, setVal] = useState("");
  return (
    <Section title={`Alternate / cross-reference numbers (${aliases.length})`}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {aliases.map((a) => (
          <span key={a.id} className="text-[12px] rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1 font-mono">
            {a.alias} <span className="text-[var(--color-faint)] not-italic">· {a.kind}</span>
          </span>
        ))}
        {aliases.length === 0 && <Empty>No cross-references yet.</Empty>}
      </div>
      <div className="flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Add an alt part number / OEM cross-ref" className="flex-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
        <button
          disabled={!val.trim()}
          onClick={async () => {
            await fetch(`/api/parts/${partId}/aliases`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: val }) });
            setVal("");
            onChanged();
          }}
          className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 disabled:opacity-40 hover:brightness-110"
        >Add</button>
      </div>
    </Section>
  );
}

function Sourcing({ partId, part, suppliers, onChanged }: { partId: string; part: Part; suppliers: Memory["suppliers"]; onChanged: () => void }) {
  const [form, setForm] = useState({ name: "", url: "", leadTime: "", price: "", notes: "" });
  return (
    <Section title="Sourcing">
      <div className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-muted)] mb-3">
        ⓘ Supplier pricing and availability require integration. Fields below show only what your team enters — nothing is estimated or auto-filled.
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mb-3 text-[12.5px]">
        <KV label="Preferred supplier" value={part.preferredSupplier} />
        <KV label="Lead time" value={part.estLeadTime} />
        <KV label="Internal stock qty" value={part.stockQty != null ? String(part.stockQty) : null} />
        <KV label="Reorder point" value={part.reorderPoint != null ? String(part.reorderPoint) : null} />
        <KV label="Manufacturer URL" value={part.manufacturerUrl} link />
        <KV label="Supplier URL" value={part.supplierUrl} link />
      </div>
      {suppliers.length > 0 && (
        <div className="space-y-1 mb-3">
          {suppliers.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-[12.5px] rounded-lg border border-[var(--color-border)] px-3 py-2">
              <span className="font-medium">{s.name}</span>
              {s.leadTime && <span className="text-[var(--color-muted)]">· {s.leadTime}</span>}
              {s.price && <span className="text-[var(--color-muted)]">· {s.price}</span>}
              {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] ml-auto">open ↗</a>}
            </div>
          ))}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supplier name" className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Supplier URL (optional)" className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
        <input value={form.leadTime} onChange={(e) => setForm({ ...form, leadTime: e.target.value })} placeholder="Lead time (e.g. 3–5 days)" className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
        <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price (as quoted, optional)" className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
      </div>
      <button
        disabled={!form.name.trim()}
        onClick={async () => {
          await fetch(`/api/parts/${partId}/suppliers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
          setForm({ name: "", url: "", leadTime: "", price: "", notes: "" });
          onChanged();
        }}
        className="mt-2 text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 disabled:opacity-40 hover:brightness-110"
      >Add supplier</button>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-3">{title}</h3>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <div className="text-[16px] font-semibold">{value}</div>
      <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{label}</div>
    </div>
  );
}
function KV({ label, value, link }: { label: string; value: string | null; link?: boolean }) {
  return (
    <div className="flex justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
      <span className="text-[var(--color-faint)]">{label}</span>
      {value ? (link ? <a href={value} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] truncate max-w-[160px]">link ↗</a> : <span className="text-[var(--color-text)] truncate max-w-[160px]">{value}</span>) : <span className="text-[var(--color-faint)]">unset</span>}
    </div>
  );
}
function Chip({ children, color, small }: { children: React.ReactNode; color: string; small?: boolean }) {
  return <span className={`${small ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5"} uppercase tracking-wide rounded-full`} style={{ color, background: "color-mix(in srgb, " + color + " 12%, transparent)" }}>{children}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-[var(--color-faint)] py-1">{children}</p>;
}
