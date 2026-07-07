"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Copilot } from "@/components/Copilot";
import { SuggestPmButton } from "@/components/SuggestPmButton";

// ───────────────────────── Types (mirror the twin payload) ─────────────────────────
interface Asset {
  id: string; name: string; assetTag?: string | null;
  site?: string | null; area?: string | null; line?: string | null; cell?: string | null;
  manufacturer?: string | null; model?: string | null; serialNumber?: string | null;
  assetType?: string | null; status?: string | null; criticality?: string | null;
  parentAssetId?: string | null; assetLevel?: string | null;
  installedAt?: number | null; imagePath?: string | null; notes?: string | null;
}
interface Doc { id: string; filename: string; kind: string; charCount?: number; createdAt?: number; }
interface Photo { id: string; caption?: string | null; }
interface Wo {
  id: string; number?: string | null; title: string; status: string; priority: string; type: string;
  // Timestamps arrive as ISO strings (Date columns) or ms numbers.
  createdAt?: number | string;
  symptom?: string | null; rootCause?: string | null; failedPart?: string | null; repairAction?: string | null;
  resolution?: string | null; downtimeMins?: number | null; closedAt?: number | string | null;
}
// Coerce an ISO-string / ms-number / null timestamp to milliseconds (0 when absent/invalid).
const toMs = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
};
interface Alarm { id: string; code?: string | null; message: string; severity: string; source: string; occurredAt: number; }
interface Plc { id: string; filename: string; controllerName?: string | null; routineCount: number; tagCount: number; fidelity: string; }
interface Sess { id: string; title: string; messageCount: number; updatedAt: number; }
interface Metrics {
  failureCount: number; avgMTTRMins: number | null;
  recurringFaults: { key: string; count: number }[];
  openWorkOrders: number; totalWorkOrders: number;
  daysSinceLastFault: number | null; suggestedPMIntervalDays: number | null;
}
interface PmSummary { id: string; title: string; status: string; frequencyLabel?: string | null; intervalDays?: number | null; }
interface PartRow { id: string; description: string; partNumber?: string | null; manufacturer?: string | null; category?: string | null; position?: string | null; criticalSpare?: boolean; }
interface Twin {
  asset: Asset; parent?: Asset | null; children?: Asset[]; ancestors?: Asset[];
  photos: Photo[]; documents: Doc[]; lessons: Doc[];
  plcProjects: Plc[]; workOrders: Wo[]; alarmEvents: Alarm[];
  pmPrograms?: PmSummary[]; parts?: PartRow[]; sessions: Sess[]; metrics: Metrics;
}

const statusStyle: Record<string, { label: string; dot: string; color: string }> = {
  operational: { label: "Operational", dot: "var(--color-green)", color: "var(--color-green)" },
  degraded: { label: "Degraded", dot: "var(--color-amber)", color: "var(--color-amber)" },
  down: { label: "Down", dot: "var(--color-red)", color: "var(--color-red)" },
  maintenance: { label: "Maintenance", dot: "var(--color-muted)", color: "var(--color-muted)" },
  retired: { label: "Retired", dot: "var(--color-faint)", color: "var(--color-faint)" },
};
const sevColor: Record<string, string> = { info: "var(--color-muted)", warning: "var(--color-amber)", fault: "var(--color-red)", critical: "var(--color-red)" };
const kindIcon: Record<string, string> = { manual: "📘", drawing: "📐", plc: "🧩", photo: "📷", alarm: "🚨", vibration: "📊", sop: "📋", lesson: "🧠", document: "📄" };

type Tab = "overview" | "pms" | "parts" | "workorders" | "failures" | "documents" | "lessons" | "plc" | "alarms" | "sessions" | "ai";

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [twin, setTwin] = useState<Twin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Honor a ?tab= deep link (e.g. from a closed work order linking to Lessons),
  // falling back to the overview when absent or unrecognized.
  const validTabs: Tab[] = ["overview", "pms", "parts", "workorders", "failures", "documents", "lessons", "plc", "alarms", "sessions", "ai"];
  // ?upload=1 (from guided setup) lands straight on Documents to upload a manual.
  const initialTab = searchParams.get("upload") === "1"
    ? "documents"
    : validTabs.includes(searchParams.get("tab") as Tab) ? (searchParams.get("tab") as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  // Whether this user can draft/approve PMs (manage_pm = owner/admin/manager).
  const [canManagePm, setCanManagePm] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCanManagePm(["owner", "admin", "manager"].includes(d?.user?.role)))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setError(null);
    return fetch(`/api/assets/${id}`)
      .then((r) => {
        if (r.status === 404) throw new Error("not_found");
        if (!r.ok) throw new Error("load");
        return r.json();
      })
      .then((d: Twin) => setTwin(d))
      .catch((e) => setError((e as Error).message === "not_found" ? "not_found" : "load"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  if (loading) return <CenterNote>Loading digital twin…</CenterNote>;
  if (error === "not_found")
    return (
      <CenterNote>
        Asset not found. <Link href="/assets" className="text-[var(--color-accent)]">← Back to equipment</Link>
      </CenterNote>
    );
  if (error || !twin)
    return (
      <div className="grid place-items-center h-full text-center">
        <div>
          <p className="text-[var(--color-red)] text-sm">We couldn&apos;t load this asset.</p>
          <button onClick={() => { setLoading(true); load(); }} className="mt-3 text-[13px] rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">Retry</button>
        </div>
      </div>
    );

  const { asset, photos, documents: docs, lessons, plcProjects, workOrders: wos, alarmEvents: alarms, sessions, metrics } = twin;
  const ancestors = twin.ancestors ?? [];
  const children = twin.children ?? [];
  const pmPrograms = twin.pmPrograms ?? [];
  const parts = twin.parts ?? [];
  // Failures = the machine's real failure record: corrective WOs with a captured
  // root cause / failed part, plus fault & critical alarms.
  const failureWos = wos.filter((w) => w.type === "corrective");
  const st = statusStyle[asset.status ?? "operational"] ?? statusStyle.operational;
  const loc = [asset.site, asset.area, asset.line, asset.cell].filter(Boolean).join(" / ");

  const tabs: [Tab, string, number?][] = [
    ["overview", "Overview"],
    ["pms", "PMs", pmPrograms.length],
    ["parts", "Parts", parts.length],
    ["workorders", "Work Orders", wos.length],
    ["failures", "Failures", failureWos.length],
    ["documents", "Drawings & Docs", docs.length],
    ["lessons", "Lessons", lessons.length],
    ["plc", "PLC", plcProjects.length],
    ["alarms", "Alarms", alarms.length],
    ["sessions", "Sessions", sessions.length],
    ["ai", "Ask AI"],
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-5 py-5">
        <Link href="/assets" className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]">← Equipment</Link>

        {/* Hierarchy breadcrumb: root → … → immediate parent → this asset */}
        {ancestors.length > 0 && (
          <nav className="mt-2 flex items-center gap-1 flex-wrap text-[11px] text-[var(--color-muted)]">
            {[...ancestors].reverse().map((a) => (
              <span key={a.id} className="flex items-center gap-1">
                <Link href={`/assets/${a.id}`} className="hover:text-[var(--color-accent)] underline-offset-2 hover:underline">
                  {a.assetLevel ? `${a.assetLevel}: ` : ""}{a.name}
                </Link>
                <span className="text-[var(--color-faint)]">›</span>
              </span>
            ))}
            <span className="text-[var(--color-text)]">{asset.name}</span>
          </nav>
        )}

        {/* Header */}
        <div className="mt-3 flex flex-col sm:flex-row gap-4">
          <PrimaryPhoto assetId={id} photos={photos} hasImage={!!asset.imagePath} onChange={load} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="min-w-0">
                <h1 className="text-[20px] font-semibold tracking-tight truncate">{asset.name}</h1>
                {asset.assetTag && <p className="text-[12px] font-mono text-[var(--color-faint)]">{asset.assetTag}</p>}
              </div>
              <span className="flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-full bg-[var(--color-surface-2)]" style={{ color: st.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />{st.label}
              </span>
              <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                {asset.criticality ?? "medium"} criticality
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[12px]">
              <Field k="Manufacturer" v={asset.manufacturer} />
              <Field k="Model" v={asset.model} />
              <Field k="Serial" v={asset.serialNumber} mono />
              <Field k="Type" v={asset.assetType} />
              <Field k="Location" v={loc} />
              <Field k="Installed" v={asset.installedAt ? new Date(asset.installedAt).toISOString().slice(0, 10) : null} />
            </dl>
          </div>
        </div>

        {/* Metric tiles */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Failures recorded" value={String(metrics.failureCount)} />
          <Metric label="Avg MTTR" value={metrics.avgMTTRMins != null ? `${metrics.avgMTTRMins} min` : "—"} />
          <Metric label="Open work orders" value={`${metrics.openWorkOrders} / ${metrics.totalWorkOrders}`} />
          <Metric label="Last fault" value={metrics.daysSinceLastFault != null ? `${metrics.daysSinceLastFault}d ago` : "—"} />
        </div>
        {(metrics.recurringFaults.length > 0 || metrics.suggestedPMIntervalDays != null) && (
          <div className="mt-3 rounded-lg bg-[var(--color-surface-2)] p-3 text-[12px] text-[var(--color-muted)] leading-relaxed">
            {metrics.recurringFaults.length > 0 && (
              <p><strong className="text-[var(--color-text)]">Recurring faults:</strong>{" "}
                {metrics.recurringFaults.map((f) => `${f.key} (×${f.count})`).join(", ")}.</p>
            )}
            {metrics.suggestedPMIntervalDays != null && (
              <p className="mt-1"><strong className="text-[var(--color-text)]">Suggested PM interval:</strong>{" "}
                every ~{metrics.suggestedPMIntervalDays} days (heuristic from fault history).</p>
            )}
          </div>
        )}

        {/* Machine action hub — what a tech actually does at the machine. */}
        <ActionHub assetId={id} setTab={setTab} />

        {/* Tabs */}
        <div className="mt-5 flex gap-1 border-b border-[var(--color-border)] overflow-x-auto">
          {tabs.map(([t, label, count]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-[13px] whitespace-nowrap border-b-2 -mb-px transition ${
                tab === t ? "border-[var(--color-accent)] text-[var(--color-text)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {label}{count != null && <span className="ml-1 text-[var(--color-faint)]">{count}</span>}
            </button>
          ))}
        </div>

        <div className="py-5">
          {tab === "overview" && <Overview assetId={id} asset={asset} metrics={metrics} parent={twin.parent ?? null} children={children} pmPrograms={pmPrograms} onChanged={load} />}
          {tab === "pms" && <PmPrograms assetId={id} pmPrograms={pmPrograms} onChanged={load} />}
          {tab === "parts" && <Parts parts={parts} />}
          {tab === "failures" && <Failures wos={failureWos} alarms={alarms} canManagePm={canManagePm} onPlanPm={() => setTab("pms")} />}
          {tab === "documents" && <Documents assetId={id} docs={docs} lessons={[]} onUpload={load} />}
          {tab === "lessons" && <Lessons lessons={lessons} />}
          {tab === "plc" && <PlcList projects={plcProjects} />}
          {tab === "workorders" && <WorkOrders assetId={id} wos={wos} />}
          {tab === "alarms" && <Alarms assetId={id} alarms={alarms} onAdd={load} />}
          {tab === "sessions" && <Sessions sessions={sessions} />}
          {tab === "ai" && (
            <div className="h-[60vh] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <Copilot assetId={id} assetName={asset.name} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Sub-components ─────────────────────────

function CenterNote({ children }: { children: React.ReactNode }) {
  return <div className="grid place-items-center h-full text-[var(--color-muted)] text-sm text-center px-4">{children}</div>;
}

function Field({ k, v, mono }: { k: string; v?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--color-faint)] text-[10px] uppercase tracking-wide">{k}</dt>
      <dd className={`truncate ${mono ? "font-mono" : "capitalize"} ${v ? "" : "text-[var(--color-faint)]"}`}>{v || "—"}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-[18px] font-semibold tracking-tight">{value}</div>
      <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{label}</div>
    </div>
  );
}

function PrimaryPhoto({ assetId, photos, hasImage, onChange }: { assetId: string; photos: Photo[]; hasImage: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const primary = photos[0];
  return (
    <div className="w-full sm:w-44 shrink-0">
      <div className="aspect-[4/3] sm:aspect-square rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] overflow-hidden grid place-items-center">
        {primary || hasImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={primary ? `/api/assets/${assetId}/photos/${primary.id}` : ""}
            alt="Asset"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[var(--color-faint)] text-[28px]">🏭</span>
        )}
      </div>
      <label className={`mt-2 flex items-center justify-center gap-1 text-[11px] rounded-lg border border-dashed border-[var(--color-border)] py-1.5 cursor-pointer hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] transition ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        {busy ? "Uploading…" : "+ Photo"}
        <input
          type="file" accept="image/*" multiple hidden
          onChange={async (e) => {
            if (!e.target.files?.length) return;
            setBusy(true);
            const form = new FormData();
            Array.from(e.target.files).forEach((f) => form.append("files", f));
            await fetch(`/api/assets/${assetId}/photos`, { method: "POST", body: form });
            setBusy(false);
            onChange();
          }}
        />
      </label>
      {photos.length > 1 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          {photos.slice(0, 6).map((p) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={p.id} src={`/api/assets/${assetId}/photos/${p.id}`} alt={p.caption ?? ""} className="w-9 h-9 rounded object-cover border border-[var(--color-border)]" />
          ))}
        </div>
      )}
    </div>
  );
}

function Overview({ assetId, asset, metrics, parent, children, pmPrograms, onChanged }: { assetId: string; asset: Asset; metrics: Metrics; parent: Asset | null; children: Asset[]; pmPrograms: PmSummary[]; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      {/* Asset hierarchy: parent + children */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <h3 className="text-[12px] uppercase tracking-wide text-[var(--color-muted)] mb-2">Asset hierarchy</h3>
        <div className="text-[13px] space-y-2">
          <div>
            <span className="text-[var(--color-faint)] text-[11px] uppercase tracking-wide">Parent</span>{" "}
            {parent ? (
              <Link href={`/assets/${parent.id}`} className="text-[var(--color-accent)] hover:underline">
                {parent.assetLevel ? `${parent.assetLevel}: ` : ""}{parent.name}
              </Link>
            ) : (
              <span className="text-[var(--color-faint)]">None (top level{asset.assetLevel ? ` · ${asset.assetLevel}` : ""})</span>
            )}
          </div>
          <div>
            <span className="text-[var(--color-faint)] text-[11px] uppercase tracking-wide">Components / children</span>
            {children.length === 0 ? (
              <span className="ml-1 text-[var(--color-faint)]">None</span>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/assets/${c.id}`} className="inline-flex items-center gap-1 text-[12px] rounded-full border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)]">
                      {c.assetLevel ? <span className="text-[var(--color-faint)]">{c.assetLevel}</span> : null}{c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Related PM programs — generated FROM this machine (asset-first). */}
      <PmPrograms assetId={assetId} pmPrograms={pmPrograms} onChanged={onChanged} />

      {/* Cross-plant OEM intelligence (the moat) — anonymized, consent-only. */}
      <NetworkIntelPanel manufacturer={asset.manufacturer} model={asset.model} />

      <div>
        <h3 className="text-[12px] uppercase tracking-wide text-[var(--color-muted)] mb-1">Notes</h3>
        <p className="text-[13px] text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
          {asset.notes || <span className="text-[var(--color-faint)]">No notes recorded for this asset.</span>}
        </p>
      </div>
      <div className="rounded-lg bg-[var(--color-surface-2)] p-3 text-[12px] text-[var(--color-muted)] leading-relaxed">
        <strong className="text-[var(--color-text)]">Reliability snapshot.</strong>{" "}
        {metrics.failureCount} recorded failures, {metrics.openWorkOrders} open of {metrics.totalWorkOrders} work orders
        {metrics.avgMTTRMins != null ? `, average repair ~${metrics.avgMTTRMins} minutes` : ""}
        {metrics.daysSinceLastFault != null ? `, last fault ${metrics.daysSinceLastFault} days ago` : ""}.
      </div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-[var(--color-faint)] py-6 text-center">{children}</p>;
}

// The action menu a technician reaches for once they're AT the machine. Repair
// and Inspect open a work order already scoped to this asset; the rest jump to
// the machine's own PMs, history, drawings, PLC, and parts.
function ActionHub({ assetId, setTab }: { assetId: string; setTab: (t: Tab) => void }) {
  const linkCls =
    "flex items-center gap-1.5 text-[13px] font-medium rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] transition whitespace-nowrap";
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <Link href={`/work-orders?asset=${assetId}&type=corrective&new=1`} className={`${linkCls} text-[var(--color-text)]`}>🔧 Repair</Link>
      <Link href={`/work-orders?asset=${assetId}&type=inspection&new=1`} className={linkCls}>🔍 Inspect</Link>
      <button onClick={() => setTab("pms")} className={linkCls}>📅 Create PM</button>
      <button onClick={() => setTab("workorders")} className={linkCls}>🗂️ View History</button>
      <button onClick={() => setTab("documents")} className={linkCls}>📐 View Drawings</button>
      <button onClick={() => setTab("plc")} className={linkCls}>🧩 View PLC</button>
      <button onClick={() => setTab("parts")} className={linkCls}>⚙️ Find Parts</button>
      <Link href={`/assets/tags?only=${assetId}`} className={linkCls} title="Print a scannable QR tag for this machine">🏷️ Print QR tag</Link>
    </div>
  );
}

// Parts used on this machine (and where). Read-only roll-up of part↔asset links.
function Parts({ parts }: { parts: PartRow[] }) {
  if (parts.length === 0)
    return <EmptyRow>No parts linked to this machine yet. Link parts from the <Link href="/parts" className="text-[var(--color-accent)] hover:underline">Parts</Link> catalog to build its bill of materials.</EmptyRow>;
  return (
    <div className="space-y-1">
      {parts.map((p) => (
        <Link key={p.id} href={`/parts/${p.id}`} className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
          <span>⚙️</span>
          <span className="truncate flex-1">{p.description}</span>
          {p.position && <span className="text-[11px] text-[var(--color-muted)] truncate">{p.position}</span>}
          {p.partNumber && <span className="font-mono text-[11px] text-[var(--color-faint)]">{p.partNumber}</span>}
          {p.criticalSpare && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full text-[var(--color-amber)] bg-[var(--color-surface-2)]">critical</span>}
        </Link>
      ))}
    </div>
  );
}

// ── Fault-signature grouping (machine memory) ───────────────────────────────
// Cluster this machine's corrective repairs by the recurring problem so a repeat
// offender reads as one story ("F007 overload ×3") with the proven fix inline —
// not a flat list. Signature priority: a fault code in the title/symptom, else
// the normalized failed part, else the normalized root cause, else the title.
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
function faultSignature(w: Wo): { key: string; label: string } {
  // Narrow fault-code detector — MUST mirror recurrence.ts faultCode(): a
  // letter-prefixed code (F007/E12) or a bare 3-4 digit code, never an incidental
  // 2-digit number ("Line 12", "20 minutes", "480 V") which would otherwise
  // fabricate a false repeat-offender group and cost banner.
  const code = `${w.title ?? ""} ${w.symptom ?? ""}`.match(/\b([a-z]\d{2,4}|\d{3,4})\b/i)?.[1];
  if (code) {
    const codeUp = code.toUpperCase();
    return { key: `code:${codeUp}`, label: codeUp };
  }
  if (norm(w.failedPart)) return { key: `part:${norm(w.failedPart)}`, label: w.failedPart!.trim() };
  if (norm(w.rootCause)) return { key: `cause:${norm(w.rootCause)}`, label: w.rootCause!.trim() };
  const t = (w.title ?? "").trim();
  return { key: `title:${norm(t)}`, label: t || "Corrective repair" };
}
interface FaultGroup { key: string; label: string; items: Wo[]; totalDowntime: number; }
function groupFailures(wos: Wo[]): FaultGroup[] {
  const map = new Map<string, FaultGroup>();
  for (const w of wos) {
    const { key, label } = faultSignature(w);
    let g = map.get(key);
    if (!g) { g = { key, label, items: [], totalDowntime: 0 }; map.set(key, g); }
    g.items.push(w);
    g.totalDowntime += Number(w.downtimeMins) || 0;
  }
  const at = (w: Wo) => toMs(w.closedAt ?? w.createdAt);
  for (const g of map.values()) g.items.sort((a, b) => at(b) - at(a));
  // Recurring problems first (by count), then most-recent.
  return [...map.values()].sort(
    (a, b) => b.items.length - a.items.length || at(b.items[0]) - at(a.items[0])
  );
}
const hrs = (mins: number) => (mins >= 60 ? `${(mins / 60).toFixed(1)} h` : `${mins} min`);

// This machine's failure record: corrective repairs grouped by recurring fault
// (with the captured root cause / failed part / proven fix inline) plus fault
// alarms — the raw material the PM loop learns from. All from real closed WOs.
function Failures({ wos, alarms, canManagePm, onPlanPm }: { wos: Wo[]; alarms: Alarm[]; canManagePm?: boolean; onPlanPm?: () => void }) {
  const faults = alarms.filter((a) => a.severity === "fault" || a.severity === "critical");
  if (wos.length === 0 && faults.length === 0)
    return <EmptyRow>No recorded failures for this machine. Corrective work orders and fault alarms will appear here.</EmptyRow>;

  const groups = groupFailures(wos);
  // The dominant repeat offender (≥2 events) — the honest "this keeps costing you" signal.
  const topRepeat = groups.find((g) => g.items.length >= 2 && g.totalDowntime > 0);
  // Seed a PM draft from the most recent CLOSED repair in the dominant group (its
  // captured close-out is the grounding); fall back to the newest item.
  const seedWo = topRepeat
    ? (topRepeat.items.find((w) => w.status === "done") ?? topRepeat.items[0])
    : null;

  return (
    <div className="space-y-4">
      {topRepeat && (
        <div className="rounded-xl border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/[0.06] p-3.5">
          <div className="flex items-start gap-3">
            <span className="text-[var(--color-amber)] text-lg leading-none mt-0.5">⚠</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">
                <span className="text-[var(--color-amber)]">{topRepeat.label}</span> has recurred{" "}
                {topRepeat.items.length}× — {hrs(topRepeat.totalDowntime)} of downtime on this machine.
              </p>
              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                Turn this repeat into a preventive program before the next failure.
              </p>
            </div>
            {seedWo && (
              <SuggestPmButton workOrderId={seedWo.id} canManagePm={!!canManagePm} onFallback={onPlanPm} />
            )}
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((g) => {
            const repeat = g.items.length >= 2;
            const avg = g.totalDowntime && g.items.filter((w) => w.downtimeMins).length
              ? Math.round(g.totalDowntime / g.items.filter((w) => w.downtimeMins).length)
              : null;
            return (
              <div key={g.key} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/40">
                  {repeat && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[var(--color-amber)]/15 text-[var(--color-amber)]">
                      ×{g.items.length}
                    </span>
                  )}
                  <span className="text-[13px] font-medium truncate flex-1">{g.label}</span>
                  <span className="text-[11px] text-[var(--color-faint)] shrink-0">
                    {repeat ? `${g.items.length} occurrences` : "1 occurrence"}
                    {avg != null ? ` · ${avg} min avg` : ""}
                  </span>
                </div>
                <div className="divide-y divide-[var(--color-border-soft)]">
                  {g.items.map((w) => {
                    // Only closed repairs have a "fix"; an open one is still being worked.
                    const fix = w.repairAction || w.failedPart || w.rootCause || w.resolution;
                    const open = w.status !== "done";
                    const when = toMs(w.closedAt ?? w.createdAt);
                    return (
                      <Link
                        key={w.id}
                        href={`/work-orders/${w.id}`}
                        className="block px-3.5 py-2.5 hover:bg-[var(--color-surface-2)]/50 transition"
                      >
                        <div className="flex items-center gap-2">
                          {w.number && <span className="font-mono text-[10px] text-[var(--color-faint)]">{w.number}</span>}
                          <span className="text-[12.5px] truncate flex-1">
                            {open ? (
                              <><span className="text-[var(--color-amber)] uppercase text-[10px] font-semibold tracking-wide mr-1">Open</span>{w.title}</>
                            ) : fix ? (
                              <><span className="text-[var(--color-muted)]">Fix:</span> {fix}</>
                            ) : (
                              w.title
                            )}
                          </span>
                          {w.downtimeMins != null && (
                            <span className="text-[11px] text-[var(--color-muted)] shrink-0">{w.downtimeMins} min down</span>
                          )}
                          <span className="text-[10px] text-[var(--color-faint)] shrink-0">
                            {when ? new Date(when).toISOString().slice(0, 10) : ""}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {faults.length > 0 && (
        <div>
          <h3 className="text-[12px] uppercase tracking-wide text-[var(--color-muted)] mb-2">Fault &amp; critical alarms</h3>
          <div className="space-y-1">
            {faults.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sevColor[a.severity] ?? "#888" }} />
                {a.code && <span className="font-mono text-[11px] text-[var(--color-faint)]">{a.code}</span>}
                <span className="truncate flex-1">{a.message}</span>
                <span className="text-[10px] text-[var(--color-faint)]">{new Date(a.occurredAt).toISOString().slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Lessons learned captured against this machine (kind=lesson). These are created
// two ways: saved from the Copilot, and auto-captured when a corrective work
// order is closed out with a resolution (Slice 4 — Maintenance Memory).
function Lessons({ lessons }: { lessons: Doc[] }) {
  if (lessons.length === 0)
    return <EmptyRow>No lessons learned recorded for this machine yet. Close out a corrective work order with what fixed it and it lands here automatically — and the Copilot can cite it next time.</EmptyRow>;
  return (
    <div className="space-y-1">
      {lessons.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
          <span>🧠</span>
          <span className="truncate flex-1">{d.filename}</span>
          {d.createdAt && <span className="text-[10px] text-[var(--color-faint)]">{new Date(d.createdAt).toISOString().slice(0, 10)}</span>}
        </div>
      ))}
    </div>
  );
}

// Cross-plant OEM intelligence — anonymized, consent-only, k-anonymous. Shows
// what the network of plants running this same make/model learned. Honest empty
// state when there isn't enough pooled data (or the machine has no OEM identity).
function NetworkIntelPanel({ manufacturer, model }: { manufacturer?: string | null; model?: string | null }) {
  const [net, setNet] = useState<{ available: boolean; reason?: string; plantCount: number; signalCount: number; resolutionBreakdown: { category: string; pct: number }[]; medianDowntimeMins: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!manufacturer && !model) { setLoading(false); return; }
    // The meaningful OEM identity is manufacturer + model. We deliberately do NOT
    // filter by assetType — the same drive/model carries different local asset
    // type labels ("drive" vs "vfd") across plants, and over-filtering would hide
    // real pooled data. Make/model is the join key that matches across tenants.
    const q = new URLSearchParams();
    if (manufacturer) q.set("manufacturer", manufacturer);
    if (model) q.set("model", model);
    fetch(`/api/network?${q.toString()}`).then((r) => r.json()).then((d) => setNet(d.network)).catch(() => {}).finally(() => setLoading(false));
  }, [manufacturer, model]);

  if (!manufacturer && !model) return null; // no OEM identity to query
  return (
    <div className="rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/[0.04] p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span>🌐</span>
        <h3 className="text-[12px] uppercase tracking-wide text-[var(--color-accent)]">Cross-plant intelligence</h3>
        <span className="text-[10px] text-[var(--color-faint)]">anonymized · opt-in</span>
      </div>
      {loading ? (
        <div className="h-8 rounded bg-[var(--color-surface-2)] animate-pulse" />
      ) : net?.available ? (
        <div className="text-[13px] space-y-1.5">
          <p className="text-[var(--color-muted)]">
            Across <strong className="text-[var(--color-text)]">{net.plantCount} plants</strong> and {net.signalCount} anonymized resolutions for {[manufacturer, model].filter(Boolean).join(" ")}:
          </p>
          <ul className="space-y-1">
            {net.resolutionBreakdown.slice(0, 4).map((r) => (
              <li key={r.category} className="flex items-center gap-2">
                <span className="w-20 capitalize text-[var(--color-text)]">{r.category}</span>
                <span className="flex-1 h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
                  <span className="block h-full bg-[var(--color-accent)]" style={{ width: `${r.pct}%` }} />
                </span>
                <span className="text-[11px] text-[var(--color-muted)] w-8 text-right">{r.pct}%</span>
              </li>
            ))}
          </ul>
          {net.medianDowntimeMins != null && (
            <p className="text-[11.5px] text-[var(--color-faint)]">Median downtime across the network: ~{net.medianDowntimeMins} min.</p>
          )}
        </div>
      ) : (
        <p className="text-[12.5px] text-[var(--color-muted)]">
          {net?.reason || "Not enough pooled data yet."} As more plants opt in, EAS learns the fastest proven fix for this exact make and model.
        </p>
      )}
    </div>
  );
}

// PM programs for THIS machine. The maintenance object model starts with the
// asset, so PMs are generated FROM here (asset → PM), not from a standalone PM
// screen. Generation links every cadence to this asset — never an orphan PM.
function PmPrograms({ assetId, pmPrograms, onChanged }: { assetId: string; pmPrograms: PmSummary[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const generate = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/pm/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setMsg(data.note || "Draft PM programs generated. Review and approve below.");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[12px] uppercase tracking-wide text-[var(--color-muted)]">PM programs</h3>
        <button
          onClick={generate}
          disabled={busy}
          className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Generating…" : "⚙️ Generate PM program"}
        </button>
      </div>
      {pmPrograms.length === 0 ? (
        <p className="text-[12px] text-[var(--color-faint)]">
          No PM programs yet. Generate a full 30/60/90-day, semi-annual &amp; annual schedule for this machine — each cadence is saved as a DRAFT for a manager to approve.
        </p>
      ) : (
        <ul className="space-y-1">
          {pmPrograms.map((p) => (
            <li key={p.id}>
              <Link href={`/pm/${p.id}`} className="flex items-center justify-between gap-2 text-[13px] rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                <span className="truncate">{p.title}</span>
                <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{p.frequencyLabel || (p.intervalDays ? `${p.intervalDays}d` : "")} · {p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-[12px] text-[var(--color-green)] mt-2 leading-snug">{msg}</p>}
    </div>
  );
}

function Documents({ assetId, docs, lessons, onUpload }: { assetId: string; docs: Doc[]; lessons: Doc[]; onUpload: () => void }) {
  const [busy, setBusy] = useState(false);
  const all = [...docs, ...lessons];
  return (
    <div>
      <label className={`inline-flex items-center gap-2 text-[12px] rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 cursor-pointer hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] transition mb-3 ${busy ? "opacity-60 pointer-events-none" : ""}`}>
        {busy ? "Indexing…" : "+ Upload documents"}
        <input
          type="file" multiple hidden
          onChange={async (e) => {
            if (!e.target.files?.length) return;
            setBusy(true);
            const form = new FormData();
            form.append("assetId", assetId);
            Array.from(e.target.files).forEach((f) => form.append("files", f));
            await fetch("/api/upload", { method: "POST", body: form });
            setBusy(false);
            onUpload();
          }}
        />
      </label>
      {all.length === 0 ? (
        <EmptyRow>No drawings, manuals, PLC exports or lessons yet. Upload to ground the Copilot in this machine.</EmptyRow>
      ) : (
        <div className="space-y-1">
          {all.map((d) => {
            const isPlc = d.kind === "plc";
            const body = (
              <div className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
                <span>{kindIcon[d.kind] ?? "📄"}</span>
                <span className="truncate flex-1">{d.filename}</span>
                <span className="text-[10px] text-[var(--color-faint)] uppercase">{d.kind}</span>
                {isPlc && <span className="text-[11px] text-[var(--color-accent)]">Open in Explorer →</span>}
              </div>
            );
            return isPlc ? (
              <Link key={d.id} href={`/knowledge`} className="block">{body}</Link>
            ) : (
              <div key={d.id}>{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlcList({ projects }: { projects: Plc[] }) {
  if (projects.length === 0) return <EmptyRow>No PLC programs linked. Upload an .L5X or .ACD on the Documents tab.</EmptyRow>;
  return (
    <div className="space-y-2">
      {projects.map((p) => (
        <Link key={p.id} href={`/plc/${p.id}`} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 hover:border-[var(--color-accent)]/50 transition">
          <span className="text-[18px]">🧩</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate">{p.filename}</p>
            <p className="text-[11px] text-[var(--color-faint)]">
              {p.controllerName ?? "Controller"} · {p.routineCount} routines · {p.tagCount} tags · fidelity {p.fidelity}
            </p>
          </div>
          <span className="text-[12px] text-[var(--color-accent)]">Open in Explorer →</span>
        </Link>
      ))}
    </div>
  );
}

function WorkOrders({ assetId, wos }: { assetId: string; wos: Wo[] }) {
  return (
    <div>
      <Link href={`/work-orders?asset=${assetId}`} className="inline-block text-[12px] rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110 mb-3">
        + Create work order
      </Link>
      {wos.length === 0 ? (
        <EmptyRow>No work orders for this asset yet.</EmptyRow>
      ) : (
        <div className="space-y-1">
          {wos.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
              <span className="font-mono text-[10px] text-[var(--color-faint)]">{w.number}</span>
              <span className="truncate flex-1">{w.title}</span>
              <span className="text-[10px] uppercase text-[var(--color-muted)]">{w.priority}</span>
              <span className="text-[10px] uppercase text-[var(--color-faint)]">{w.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Alarms({ assetId, alarms, onAdd }: { assetId: string; alarms: Alarm[]; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", message: "", severity: "fault" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.message.trim() || saving) return;
    setSaving(true);
    await fetch(`/api/assets/${assetId}/alarms`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    setSaving(false);
    setOpen(false);
    setForm({ code: "", message: "", severity: "fault" });
    onAdd();
  };
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="text-[12px] rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)] mb-3">
        {open ? "Cancel" : "+ Record alarm / fault"}
      </button>
      {open && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 mb-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Code (F081)" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]" />
            <input placeholder="Message" value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} className="col-span-2 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]" />
          </div>
          <div className="flex items-center gap-2">
            <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]">
              <option value="info">Info</option><option value="warning">Warning</option><option value="fault">Fault</option><option value="critical">Critical</option>
            </select>
            <button onClick={submit} disabled={!form.message.trim() || saving} className="text-[12px] rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}
      {alarms.length === 0 ? (
        <EmptyRow>No alarms or faults recorded for this asset.</EmptyRow>
      ) : (
        <div className="space-y-1">
          {alarms.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sevColor[a.severity] ?? "#888" }} />
              {a.code && <span className="font-mono text-[11px] text-[var(--color-faint)]">{a.code}</span>}
              <span className="truncate flex-1">{a.message}</span>
              <span className="text-[10px] uppercase text-[var(--color-faint)]">{a.severity}</span>
              <span className="text-[10px] text-[var(--color-faint)]">{new Date(a.occurredAt).toISOString().slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sessions({ sessions }: { sessions: Sess[] }) {
  if (sessions.length === 0) return <EmptyRow>No troubleshooting sessions for this asset yet.</EmptyRow>;
  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <Link key={s.id} href={`/copilot?c=${s.id}`} className="flex items-center gap-2 text-[13px] rounded-lg px-3 py-2 hover:bg-[var(--color-surface-2)]">
          <span className="text-[var(--color-accent)]">💬</span>
          <span className="truncate flex-1">{s.title}</span>
          <span className="text-[10px] text-[var(--color-faint)]">{s.messageCount} msgs</span>
        </Link>
      ))}
    </div>
  );
}
