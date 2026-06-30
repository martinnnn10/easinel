"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/TopBar";

interface WorkOrder {
  id: string;
  number?: string;
  title: string;
  symptom?: string | null;
  description?: string | null;
  priority: string;
  status: string;
  type: string;
  source: string;
  assetId?: string | null;
  externalSystem?: string | null;
  downtimeMins?: number | null;
  approvalStatus?: string;
  requestedBy?: string | null;
  approvedBy?: string | null;
  rejectionReason?: string | null;
  createdAt?: number;
}
interface Stats {
  open: number;
  inProgress: number;
  onHold: number;
  done: number;
  total: number;
  avgDowntimeMins: number | null;
}
interface AssetLite {
  id: string;
  name: string;
}

// Roles allowed to approve/reject maintenance requests (mirrors the server
// approve_work_order permission: owner/admin/manager).
const APPROVER_ROLES = ["owner", "admin", "manager"];

const statusLabel: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  done: "Done",
  synced: "Synced",
};
const statusColor: Record<string, string> = {
  open: "var(--color-amber)",
  in_progress: "var(--color-accent)",
  on_hold: "var(--color-faint)",
  done: "var(--color-green)",
  synced: "var(--color-green)",
};
const prioColor: Record<string, string> = {
  urgent: "var(--color-red)",
  high: "var(--color-amber)",
  medium: "var(--color-accent)",
  low: "var(--color-faint)",
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "on_hold", label: "On hold" },
  { key: "done", label: "Done" },
];

type View = "board" | "approvals";

export default function WorkOrdersPage() {
  const [view, setView] = useState<View>("board");
  const [wos, setWos] = useState<WorkOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  // Role / permissions (derived from /api/auth/me).
  const [role, setRole] = useState<string>("owner");
  const canApprove = APPROVER_ROLES.includes(role);

  // Approvals queue.
  const [requests, setRequests] = useState<WorkOrder[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setRole(d?.user?.role ?? "owner"))
      .catch(() => setRole("owner"));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadPendingCount = useCallback(async () => {
    try {
      const r = await fetch("/api/work-orders/requests?approval=pending");
      if (!r.ok) return;
      const d = await r.json();
      setPendingCount((d.requests ?? []).length);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ stats: "1" });
      if (filter) sp.set("status", filter);
      if (debounced) sp.set("search", debounced);
      const r = await fetch(`/api/work-orders?${sp.toString()}`);
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      const d = await r.json();
      setWos(d.workOrders ?? []);
      setStats(d.stats ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter, debounced]);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/work-orders/requests?approval=pending");
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      const d = await r.json();
      setRequests(d.requests ?? []);
      setPendingCount((d.requests ?? []).length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPendingCount();
  }, [loadPendingCount]);

  useEffect(() => {
    if (view === "board") loadBoard();
    else loadApprovals();
  }, [view, loadBoard, loadApprovals]);

  return (
    <>
      <TopBar
        title="Work Orders"
        subtitle="Report a problem, request work, approve it, and close it out"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRequest(true)}
              className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)]"
            >
              Request work
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110"
            >
              + New
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-5 py-5 sm:py-6">
          {/* View tabs: active board vs. approvals queue */}
          <div className="flex items-center gap-1.5 mb-5">
            <button
              onClick={() => setView("board")}
              className={`text-[13px] font-medium rounded-lg px-3.5 py-1.5 border transition ${
                view === "board"
                  ? "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              Active board
            </button>
            <button
              onClick={() => setView("approvals")}
              className={`text-[13px] font-medium rounded-lg px-3.5 py-1.5 border transition flex items-center gap-2 ${
                view === "approvals"
                  ? "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              Approvals
              {pendingCount > 0 && (
                <span className="text-[10px] font-semibold rounded-full bg-[var(--color-amber)] text-black px-1.5 py-0.5 leading-none">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>

          {view === "board" ? (
            <BoardView
              wos={wos}
              stats={stats}
              loading={loading}
              error={error}
              filter={filter}
              setFilter={setFilter}
              search={search}
              setSearch={setSearch}
              debounced={debounced}
              onReload={loadBoard}
              onCreate={() => setShowForm(true)}
            />
          ) : (
            <ApprovalsView
              requests={requests}
              loading={loading}
              error={error}
              canApprove={canApprove}
              onReload={() => {
                loadApprovals();
              }}
              onRequest={() => setShowRequest(true)}
            />
          )}
        </div>
      </div>

      {showForm && (
        <NewWorkOrderModal
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            loadBoard();
          }}
        />
      )}
      {showRequest && (
        <RequestModal
          onClose={() => setShowRequest(false)}
          onCreated={() => {
            setShowRequest(false);
            loadPendingCount();
            if (view === "approvals") loadApprovals();
          }}
        />
      )}
    </>
  );
}

// ───────────────────────── Board view ─────────────────────────

function BoardView({
  wos,
  stats,
  loading,
  error,
  filter,
  setFilter,
  search,
  setSearch,
  debounced,
  onReload,
  onCreate,
}: {
  wos: WorkOrder[];
  stats: Stats | null;
  loading: boolean;
  error: string | null;
  filter: string;
  setFilter: (s: string) => void;
  search: string;
  setSearch: (s: string) => void;
  debounced: string;
  onReload: () => void;
  onCreate: () => void;
}) {
  return (
    <>
      {/* Machine-down hero — the wedge: "A machine is down." */}
      <button
        onClick={onCreate}
        className="w-full text-left rounded-2xl border border-[var(--color-red)]/40 bg-[var(--color-red)]/[0.06] px-4 sm:px-5 py-4 mb-5 hover:bg-[var(--color-red)]/[0.1] transition active:scale-[0.99]"
      >
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--color-red)]/15 text-[var(--color-red)] text-xl shrink-0">
            ⚠
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">A machine is down</p>
            <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
              Report the symptom and get a grounded troubleshooting answer in seconds.
            </p>
          </div>
        </div>
      </button>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
        <Kpi label="Open" value={stats ? stats.open + stats.inProgress + stats.onHold : "—"} tone="amber" loading={loading && !stats} />
        <Kpi label="In progress" value={stats?.inProgress ?? "—"} tone="accent" loading={loading && !stats} />
        <Kpi label="Closed" value={stats?.done ?? "—"} tone="green" loading={loading && !stats} />
        <Kpi
          label="Avg downtime"
          value={stats?.avgDowntimeMins != null ? `${stats.avgDowntimeMins}m` : "—"}
          tone="default"
          loading={loading && !stats}
        />
      </div>

      {/* Filter chips + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-4">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 text-[12px] font-medium rounded-full px-3.5 py-1.5 border transition ${
                filter === f.key
                  ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work orders…"
            className="w-full sm:w-60 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] pl-8 pr-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)] text-[13px]">⌕</span>
        </div>
      </div>

      {/* List */}
      {error ? (
        <ErrorState message={error} onRetry={onReload} />
      ) : loading ? (
        <ListSkeleton />
      ) : wos.length === 0 ? (
        <EmptyState hasFilter={!!filter || !!debounced} onCreate={onCreate} />
      ) : (
        <div className="space-y-2">
          {wos.map((w) => (
            <Link
              key={w.id}
              href={`/work-orders/${w.id}`}
              className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)] transition active:scale-[0.995]"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-1.5 h-10 rounded-full shrink-0"
                  style={{ background: prioColor[w.priority] ?? "var(--color-faint)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-[var(--color-faint)]">{w.number}</span>
                    <span
                      className="text-[10px] uppercase px-1.5 py-0.5 rounded font-medium"
                      style={{
                        background: `color-mix(in srgb, ${statusColor[w.status] ?? "var(--color-faint)"} 14%, transparent)`,
                        color: statusColor[w.status] ?? "var(--color-text)",
                      }}
                    >
                      {statusLabel[w.status] ?? w.status}
                    </span>
                    {w.source === "copilot" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                        Copilot
                      </span>
                    )}
                    {w.externalSystem && (
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[var(--color-green)]/10 text-[var(--color-green)]">
                        ↑ {w.externalSystem}
                      </span>
                    )}
                  </div>
                  <p className="text-[13.5px] font-medium truncate mt-1">{w.title}</p>
                  {w.symptom && w.symptom !== w.title && (
                    <p className="text-[12px] text-[var(--color-muted)] truncate mt-0.5">{w.symptom}</p>
                  )}
                </div>
                {w.status === "done" && w.downtimeMins != null && (
                  <span className="text-[11px] text-[var(--color-muted)] shrink-0 hidden sm:block">
                    {w.downtimeMins}m down
                  </span>
                )}
                <span className="text-[var(--color-faint)] shrink-0">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// ───────────────────────── Approvals view ─────────────────────────

function ApprovalsView({
  requests,
  loading,
  error,
  canApprove,
  onReload,
  onRequest,
}: {
  requests: WorkOrder[];
  loading: boolean;
  error: string | null;
  canApprove: boolean;
  onReload: () => void;
  onRequest: () => void;
}) {
  return (
    <>
      <div className="rounded-2xl border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/[0.05] px-4 sm:px-5 py-4 mb-5">
        <p className="text-[15px] font-semibold">Maintenance requests awaiting approval</p>
        <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
          {canApprove
            ? "Approve a request to turn it into an active work order, or reject it with a reason. Only managers/supervisors can approve."
            : "These requests are awaiting a maintenance manager/supervisor sign-off. You can submit a new request anytime."}
        </p>
        <button
          onClick={onRequest}
          className="mt-3 text-[13px] font-medium rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-1.5 hover:bg-[var(--color-surface-2)]"
        >
          + Request maintenance
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={onReload} />
      ) : loading ? (
        <ListSkeleton />
      ) : requests.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl">
          <p className="text-[15px] font-medium">No pending requests</p>
          <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto px-4">
            When someone submits a maintenance request, it appears here for a manager/supervisor to approve.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {requests.map((r) => (
            <RequestCard key={r.id} req={r} canApprove={canApprove} onDone={onReload} />
          ))}
        </div>
      )}
    </>
  );
}

function RequestCard({
  req,
  canApprove,
  onDone,
}: {
  req: WorkOrder;
  canApprove: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: "approve" | "reject") => {
    if (action === "reject" && !reason.trim()) {
      setRejecting(true);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/work-orders/requests/${req.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action } : { action, reason: reason.trim() }
        ),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message || `Failed (${r.status})`);
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
      <div className="flex items-start gap-3">
        <span
          className="w-1.5 h-10 rounded-full shrink-0 mt-0.5"
          style={{ background: prioColor[req.priority] ?? "var(--color-faint)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-[var(--color-faint)]">{req.number}</span>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-medium bg-[var(--color-amber)]/15 text-[var(--color-amber)]">
              Pending approval
            </span>
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">
              {req.priority}
            </span>
          </div>
          <p className="text-[13.5px] font-medium mt-1">{req.title}</p>
          {req.symptom && req.symptom !== req.title && (
            <p className="text-[12px] text-[var(--color-muted)] mt-0.5">{req.symptom}</p>
          )}
          {req.description && (
            <p className="text-[12px] text-[var(--color-muted)] mt-0.5 whitespace-pre-line">{req.description}</p>
          )}
          {req.requestedBy && (
            <p className="text-[11px] text-[var(--color-faint)] mt-1">Requested by {req.requestedBy}</p>
          )}

          {rejecting && (
            <div className="mt-2.5">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for rejection (required)…"
                className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-red)]"
              />
            </div>
          )}
          {err && <p className="text-[12px] text-[var(--color-red)] mt-2">{err}</p>}

          {canApprove ? (
            <div className="flex items-center gap-2 mt-3">
              <button
                disabled={busy}
                onClick={() => act("approve")}
                className="text-[12.5px] font-medium rounded-lg bg-[var(--color-green)] text-white px-3.5 py-1.5 disabled:opacity-40 hover:brightness-110"
              >
                {busy ? "…" : "Approve"}
              </button>
              <button
                disabled={busy}
                onClick={() => act("reject")}
                className="text-[12.5px] font-medium rounded-lg border border-[var(--color-red)]/50 text-[var(--color-red)] px-3.5 py-1.5 disabled:opacity-40 hover:bg-[var(--color-red)]/10"
              >
                {rejecting ? (busy ? "…" : "Confirm reject") : "Reject"}
              </button>
              {rejecting && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setRejecting(false);
                    setReason("");
                  }}
                  className="text-[12.5px] text-[var(--color-muted)] px-2 py-1.5 hover:text-[var(--color-text)]"
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-faint)] mt-2.5 italic">
              Awaiting manager/supervisor approval.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Shared bits ─────────────────────────

function Kpi({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: number | string;
  tone: "amber" | "accent" | "green" | "default";
  loading: boolean;
}) {
  const color =
    tone === "amber"
      ? "var(--color-amber)"
      : tone === "accent"
      ? "var(--color-accent)"
      : tone === "green"
      ? "var(--color-green)"
      : "var(--color-text)";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</p>
      {loading ? (
        <div className="h-6 w-10 mt-1 rounded bg-[var(--color-surface-2)] animate-pulse" />
      ) : (
        <p className="text-[20px] font-semibold mt-0.5" style={{ color }}>
          {value}
        </p>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-10 rounded-full bg-[var(--color-surface-2)] animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
              <div className="h-3.5 w-2/3 rounded bg-[var(--color-surface-2)] animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasFilter, onCreate }: { hasFilter: boolean; onCreate: () => void }) {
  return (
    <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-2xl">
      <p className="text-[15px] font-medium">{hasFilter ? "No matching work orders" : "No work orders yet"}</p>
      <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto px-4">
        {hasFilter
          ? "Try a different filter or search term."
          : "When a machine goes down, report it here. The Copilot diagnoses it, you work it, and EAS remembers the fix."}
      </p>
      {!hasFilter && (
        <button
          onClick={onCreate}
          className="mt-4 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-4 py-2 hover:brightness-110"
        >
          Report a machine down
        </button>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16 border border-dashed border-[var(--color-red)]/40 rounded-2xl">
      <p className="text-[15px] font-medium text-[var(--color-red)]">Couldn’t load</p>
      <p className="text-[var(--color-muted)] text-sm mt-1">{message}</p>
      <button onClick={onRetry} className="mt-4 text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">
        Retry
      </button>
    </div>
  );
}

// ───────────────────────── New work order (immediate) ─────────────────────────

function NewWorkOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    symptom: "",
    assetId: "",
    priority: "high",
    type: "corrective",
  });
  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((d) => setAssets((d.assets ?? []).map((a: AssetLite) => ({ id: a.id, name: a.name }))))
      .catch(() => setAssets([]));
  }, []);

  const submit = async (openCopilot: boolean) => {
    if (!form.symptom.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.symptom.trim(),
          symptom: form.symptom.trim(),
          assetId: form.assetId || null,
          priority: form.priority,
          type: form.type,
        }),
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const d = await r.json();
      if (openCopilot && d.workOrder?.id) {
        router.push(`/work-orders/${d.workOrder.id}?ask=1`);
        return;
      }
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-[15px] mb-1">What’s down?</h2>
        <p className="text-[12px] text-[var(--color-muted)] mb-4">
          Describe the symptom the way you’d say it out loud. You can refine it later.
        </p>
        <div className="space-y-3">
          <textarea
            autoFocus
            placeholder="e.g. Conveyor 3 keeps faulting F007 about 20 minutes after startup"
            value={form.symptom}
            onChange={(e) => setForm({ ...form, symptom: e.target.value })}
            rows={3}
            className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--color-accent)] resize-none"
          />
          <select
            value={form.assetId}
            onChange={(e) => setForm({ ...form, assetId: e.target.value })}
            className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none"
          >
            <option value="">No specific asset</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none">
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none">
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
              <option value="inspection">Inspection</option>
            </select>
          </div>
        </div>
        {err && <p className="text-[12px] text-[var(--color-red)] mt-3">{err}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[13px] px-3 py-2.5 sm:py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Cancel
          </button>
          <button
            disabled={!form.symptom.trim() || saving}
            onClick={() => submit(false)}
            className="text-[13px] font-medium px-4 py-2.5 sm:py-1.5 rounded-lg border border-[var(--color-border)] disabled:opacity-40 hover:bg-[var(--color-surface-2)]"
          >
            {saving ? "Saving…" : "Just log it"}
          </button>
          <button
            disabled={!form.symptom.trim() || saving}
            onClick={() => submit(true)}
            className="text-[13px] font-medium px-4 py-2.5 sm:py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 hover:brightness-110"
          >
            {saving ? "Saving…" : "Log + ask Copilot"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Request maintenance (approval-gated) ─────────────────────────

function RequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    symptom: "",
    assetId: "",
    area: "",
    priority: "medium",
    type: "corrective",
  });
  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((d) => setAssets((d.assets ?? []).map((a: AssetLite) => ({ id: a.id, name: a.name }))))
      .catch(() => setAssets([]));
  }, []);

  const submit = async () => {
    if (!form.symptom.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/work-orders/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symptom: form.symptom.trim(),
          assetId: form.assetId || null,
          area: form.area.trim() || null,
          priority: form.priority,
          type: form.type,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message || `Failed (${r.status})`);
      }
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-[15px] mb-1">Request maintenance</h2>
        <p className="text-[12px] text-[var(--color-muted)] mb-4">
          This creates a request that a maintenance manager/supervisor must approve before it becomes an active work order.
        </p>
        <div className="space-y-3">
          <textarea
            autoFocus
            placeholder="What needs maintenance? e.g. Air leak on the Line A palletizer clamp cylinder"
            value={form.symptom}
            onChange={(e) => setForm({ ...form, symptom: e.target.value })}
            rows={3}
            className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--color-accent)] resize-none"
          />
          <select
            value={form.assetId}
            onChange={(e) => setForm({ ...form, assetId: e.target.value })}
            className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none"
          >
            <option value="">No specific asset</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            placeholder="General area affected (optional) — e.g. Press Area, Line A"
            className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none">
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[13px] outline-none">
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
              <option value="inspection">Inspection</option>
            </select>
          </div>
        </div>
        {err && <p className="text-[12px] text-[var(--color-red)] mt-3">{err}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[13px] px-3 py-2.5 sm:py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Cancel
          </button>
          <button
            disabled={!form.symptom.trim() || saving}
            onClick={submit}
            className="text-[13px] font-medium px-4 py-2.5 sm:py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 hover:brightness-110"
          >
            {saving ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
