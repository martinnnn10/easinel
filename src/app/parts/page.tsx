"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";

interface Part {
  id: string;
  description: string;
  partNumber: string | null;
  manufacturer: string | null;
  manufacturerPartNumber: string | null;
  category: string | null;
}
interface Match {
  part: Part;
  confidence: "high" | "medium" | "low";
  score: number;
  evidence: string[];
}
interface SearchResult {
  query: string;
  detectedManufacturer: string | null;
  inferredCategory: string | null;
  bestMatch: Match | null;
  matches: Match[];
  weak: boolean;
  note: string | null;
}
interface Memory {
  assets: { assetId: string; name: string | null; position: string | null }[];
  failure: { failureCount: number; lastFailedAt: number | null; avgDowntimeMins: number | null };
  workOrders: { workOrderId: string; number: string | null; title: string; role: string }[];
}
interface Compatible { part: Part; reasons: string[] }

const confColor: Record<string, string> = { high: "var(--color-green)", medium: "var(--color-amber)", low: "var(--color-faint)" };

export default function PartsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [browse, setBrowse] = useState<Part[]>([]);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [compatible, setCompatible] = useState<Compatible[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const loadBrowse = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/parts");
      if (!res.ok) throw new Error("Failed to load parts");
      setBrowse((await res.json()).parts ?? []);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBrowse(); }, [loadBrowse]);

  // Debounced AI search.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResult(null); setMemory(null); setCompatible([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r: SearchResult = (await fetch(`/api/parts/search?q=${encodeURIComponent(query)}`).then((x) => x.json())).result;
        setResult(r);
        if (r.bestMatch) {
          const [mem, comp] = await Promise.all([
            fetch(`/api/parts/${r.bestMatch.part.id}/usage`).then((x) => x.json()).then((d) => d.memory).catch(() => null),
            fetch(`/api/parts/${r.bestMatch.part.id}/compatible`, { method: "POST" }).then((x) => x.json()).then((d) => d.compatible ?? []).catch(() => []),
          ]);
          setMemory(mem); setCompatible(comp);
        } else { setMemory(null); setCompatible([]); }
      } finally { setSearching(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <TopBar
        title="Parts"
        subtitle="Find a part from a messy search — number, model, or plain description"
        right={<button onClick={() => setShowForm(true)} className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110">+ Add part</button>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6">
          {/* 1 — Search anything */}
          <div className="relative mb-5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search part number, model, serial, asset, or describe what you're looking for…"
              className="w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-3 text-[14px] outline-none focus:border-[var(--color-accent)]"
            />
            {searching && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-[var(--color-faint)]">searching…</span>}
          </div>

          {q.trim() && result ? (
            <div className="space-y-4">
              {(result.detectedManufacturer || result.inferredCategory) && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {result.detectedManufacturer && <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)]">Likely manufacturer: <span className="text-[var(--color-text)]">{result.detectedManufacturer}</span></span>}
                  {result.inferredCategory && <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)]">Category: <span className="text-[var(--color-text)]">{result.inferredCategory}</span></span>}
                </div>
              )}

              {result.note && (
                <div className="rounded-xl border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5 px-4 py-3 text-[13px] text-[#f1d9a8]">⚠️ {result.note}</div>
              )}

              {/* 2 — Best match */}
              {result.bestMatch && (
                <Panel title="Best match">
                  <MatchCard m={result.bestMatch} onOpen={() => router.push(`/parts/${result.bestMatch!.part.id}`)} />
                </Panel>
              )}

              {result.matches.length > 1 && (
                <Panel title={`Other matches (${result.matches.length - 1})`}>
                  <div className="space-y-1.5">
                    {result.matches.slice(1).map((mt) => (
                      <button key={mt.part.id} onClick={() => router.push(`/parts/${mt.part.id}`)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                        <span className="flex-1 truncate text-[13px]">{mt.part.description}</span>
                        <span className="text-[10px] uppercase" style={{ color: confColor[mt.confidence] }}>{mt.confidence}</span>
                      </button>
                    ))}
                  </div>
                </Panel>
              )}

              {/* 3 — Compatible replacements */}
              {result.bestMatch && (
                <Panel title="Compatible replacements">
                  {compatible.length === 0 ? <Empty>No compatible replacements in your catalog yet.</Empty> : (
                    <div className="space-y-1.5">
                      {compatible.map((c) => (
                        <button key={c.part.id} onClick={() => router.push(`/parts/${c.part.id}`)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                          <span className="flex-1 truncate text-[13px]">{c.part.description}</span>
                          <span className="text-[10.5px] text-[var(--color-faint)]">{c.reasons[0]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              )}

              {/* 4 — Used on these assets */}
              {result.bestMatch && (
                <Panel title="Used on these assets">
                  {!memory || memory.assets.length === 0 ? <Empty>Not linked to any asset yet.</Empty> : (
                    <div className="space-y-1">
                      {memory.assets.map((a) => (
                        <button key={a.assetId} onClick={() => router.push(`/assets/${a.assetId}`)} className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)] text-[13px]">
                          <span>🏭</span><span className="flex-1 truncate">{a.name ?? a.assetId}</span>{a.position && <span className="text-[11px] text-[var(--color-faint)]">{a.position}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </Panel>
              )}

              {/* 5 — Failure history */}
              {result.bestMatch && (
                <Panel title="Failure history">
                  {!memory || memory.failure.failureCount === 0 ? <Empty>No recorded failures for this part.</Empty> : (
                    <div className="flex flex-wrap gap-4 text-[13px]">
                      <span>Failed <strong>{memory.failure.failureCount}×</strong></span>
                      <span className="text-[var(--color-muted)]">Last: {memory.failure.lastFailedAt ? new Date(memory.failure.lastFailedAt).toLocaleDateString() : "—"}</span>
                      <span className="text-[var(--color-muted)]">Avg downtime: {memory.failure.avgDowntimeMins != null ? `${memory.failure.avgDowntimeMins} min` : "—"}</span>
                    </div>
                  )}
                </Panel>
              )}
            </div>
          ) : (
            <Browse parts={browse} loading={loading} error={error} onRetry={loadBrowse} onOpen={(id) => router.push(`/parts/${id}`)} onAdd={() => setShowForm(true)} />
          )}
        </div>
      </div>

      {showForm && <AddPartModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); loadBrowse(); }} />}
    </>
  );
}

function MatchCard({ m, onOpen }: { m: Match; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 hover:border-[var(--color-accent)]/50 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold truncate">{m.part.description}</p>
          <p className="text-[12px] text-[var(--color-faint)] mt-0.5">{[m.part.manufacturer, m.part.partNumber || m.part.manufacturerPartNumber, m.part.category].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0" style={{ color: confColor[m.confidence], background: "color-mix(in srgb, " + confColor[m.confidence] + " 12%, transparent)" }}>{m.confidence} confidence</span>
      </div>
      {m.evidence.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {m.evidence.map((e, i) => <li key={i} className="text-[11px] rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-muted)]">{e}</li>)}
        </ul>
      )}
    </button>
  );
}

function Browse({ parts, loading, error, onRetry, onOpen, onAdd }: { parts: Part[]; loading: boolean; error: string; onRetry: () => void; onOpen: (id: string) => void; onAdd: () => void }) {
  if (loading) return <div className="space-y-2">{[0,1,2].map((i) => <div key={i} className="h-14 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] animate-pulse" />)}</div>;
  if (error) return <div className="rounded-xl border border-[var(--color-red)]/40 bg-[var(--color-red)]/5 p-4 text-[13px] text-[var(--color-red)]">{error} <button onClick={onRetry} className="underline">Retry</button></div>;
  if (parts.length === 0) return (
    <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
      <div className="w-12 h-12 mx-auto rounded-xl bg-[var(--color-surface-2)] grid place-items-center mb-4 text-xl">⚡</div>
      <p className="text-[15px] font-medium">No parts in your catalog yet</p>
      <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">Add the spares your team stocks. Then search by part number, manufacturer, or plain description — and the part remembers where it's used and how it has failed.</p>
      <button onClick={onAdd} className="mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110">+ Add your first part</button>
    </div>
  );
  return (
    <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
      {parts.map((p, i) => (
        <button key={p.id} onClick={() => onOpen(p.id)} className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)] ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
          <span className="w-9 h-9 rounded-lg bg-[var(--color-surface-2)] grid place-items-center text-[var(--color-accent)] shrink-0">⚙️</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate">{p.description}</p>
            <p className="text-[11px] text-[var(--color-faint)] truncate">{[p.manufacturer, p.partNumber || p.manufacturerPartNumber, p.category].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-2.5">{title}</h3>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="text-[12.5px] text-[var(--color-faint)]">{children}</p>; }

function AddPartModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ description: "", partNumber: "", manufacturer: "", category: "" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-[15px] mb-4">Add part</h2>
        <div className="space-y-3">
          {[["description","Description *"],["manufacturer","Manufacturer"],["partNumber","Part number"],["category","Category"]].map(([k,label]) => (
            <input key={k} placeholder={label} value={(form as Record<string,string>)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button disabled={busy || !form.description.trim()} onClick={async () => { setBusy(true); const res = await fetch("/api/parts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); if (res.ok) onSaved(); else setBusy(false); }} className="text-[13px] font-medium px-4 py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 hover:brightness-110">{busy ? "Adding…" : "Add part"}</button>
        </div>
      </div>
    </div>
  );
}
