"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Copilot } from "@/components/Copilot";
import { Markdown } from "@/components/Markdown";

interface WorkOrder {
  id: string;
  number?: string;
  title: string;
  symptom?: string | null;
  description?: string | null;
  resolution?: string | null;
  priority: string;
  status: string;
  type: string;
  source: string;
  assetId?: string | null;
  assignedTo?: string | null;
  externalSystem?: string | null;
  reportedAt?: number | null;
  startedAt?: number | null;
  closedAt?: number | null;
  downtimeMins?: number | null;
  rootCause?: string | null;
  failedPart?: string | null;
  createdAt?: number;
}
interface HistoryEvent {
  id: string;
  kind: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  actor: string;
  at: number;
}

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

// The lifecycle actions shown for each state (mirrors the server state machine).
const ACTIONS: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  open: [
    { to: "in_progress", label: "Start work", primary: true },
    { to: "on_hold", label: "Hold" },
  ],
  in_progress: [
    { to: "done", label: "Close out", primary: true },
    { to: "on_hold", label: "Hold" },
  ],
  on_hold: [
    { to: "in_progress", label: "Resume", primary: true },
  ],
  done: [{ to: "open", label: "Reopen" }],
  synced: [{ to: "in_progress", label: "Start work", primary: true }],
};

function fmt(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [assetName, setAssetName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"work" | "copilot">(searchParams.get("ask") === "1" ? "copilot" : "work");
  const [closeOut, setCloseOut] = useState(false);
  const [busy, setBusy] = useState(false);
  // Errors from a lifecycle ACTION (transition/close-out), kept separate from the
  // page-LOAD error so a failed action never blanks the page, and a stale load
  // error never bleeds into the action UI.
  const [actionError, setActionError] = useState<string | null>(null);
  const [pmState, setPmState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [pmMsg, setPmMsg] = useState("");
  // RCA generation
  const [rca, setRca] = useState<{ markdown: string; confidence: string; aiGenerated: boolean } | null>(null);
  const [rcaState, setRcaState] = useState<"idle" | "loading" | "open" | "saving" | "saved" | "error">("idle");
  const [rcaMsg, setRcaMsg] = useState("");

  const generateRca = async (save: boolean) => {
    setRcaState(save ? "saving" : "loading");
    setRcaMsg("");
    try {
      const r = await fetch(`/api/work-orders/${id}/rca`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ save }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || "Failed");
      setRca(d.rca);
      if (save) { setRcaState("saved"); setRcaMsg("Saved to Knowledge — the Copilot can now cite this RCA."); }
      else setRcaState("open");
    } catch (e) {
      setRcaMsg((e as Error).message);
      setRcaState("error");
    }
  };

  const suggestPm = async () => {
    setPmState("loading");
    try {
      const r = await fetch("/api/pm/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workOrderId: id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || "Failed");
      setPmMsg(`Draft PM created (${d.confidence} confidence, ${d.evidenceCount} evidence items). Review & approve it under PM Program.`);
      setPmState("done");
    } catch (e) {
      setPmMsg((e as Error).message);
      setPmState("error");
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/work-orders/${id}`);
      if (r.status === 404) throw new Error("Work order not found");
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      const d = await r.json();
      setWo(d.workOrder);
      setHistory(d.history ?? []);
      if (d.workOrder?.assetId) {
        fetch(`/api/assets/${d.workOrder.assetId}`)
          .then((x) => x.json())
          .then((a) => setAssetName(a.asset?.name ?? a.name ?? ""))
          .catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Drive a lifecycle transition. Returns true on success so callers (e.g. the
  // close-out modal) can decide whether to dismiss. Guards against double-submit
  // via `busy`, surfaces EVERY failure mode, and on failure leaves the UI exactly
  // as it was (modal open, input preserved) so nothing is silently lost.
  const transition = async (
    to: string,
    extra: {
      note?: string;
      resolution?: string;
      rootCause?: string;
      failedPart?: string;
      repairAction?: string;
    } = {}
  ): Promise<boolean> => {
    if (busy) return false; // ignore re-entrant clicks
    setBusy(true);
    setActionError(null);
    try {
      const r = await fetch(`/api/work-orders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: to, ...extra }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as { message?: string }));
        setActionError(
          r.status === 409
            ? `That status change isn’t allowed (${d.message ?? "invalid transition"}).`
            : d.message || `Couldn’t update this work order (error ${r.status}). Please try again.`
        );
        return false;
      }
      await load();
      return true;
    } catch {
      setActionError("Network error — check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar
        title={wo ? wo.number || "Work order" : "Work order"}
        subtitle={wo?.title}
        right={
          <Link href="/work-orders" className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-text)]">
            ← All
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 py-5 sm:py-6">
          {loading ? (
            <DetailSkeleton />
          ) : error && !wo ? (
            <div className="text-center py-16 border border-dashed border-[var(--color-red)]/40 rounded-2xl">
              <p className="text-[15px] font-medium text-[var(--color-red)]">{error}</p>
              <Link href="/work-orders" className="inline-block mt-4 text-[13px] rounded-lg border border-[var(--color-border)] px-4 py-2 hover:bg-[var(--color-surface-2)]">
                Back to work orders
              </Link>
            </div>
          ) : wo ? (
            <>
              {/* Header card */}
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="w-1.5 h-12 rounded-full shrink-0" style={{ background: prioColor[wo.priority] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="text-[10px] uppercase px-2 py-0.5 rounded font-medium"
                        style={{
                          background: `color-mix(in srgb, ${statusColor[wo.status]} 14%, transparent)`,
                          color: statusColor[wo.status],
                        }}
                      >
                        {statusLabel[wo.status] ?? wo.status}
                      </span>
                      <span className="text-[11px] uppercase text-[var(--color-muted)]">{wo.priority} · {wo.type}</span>
                    </div>
                    <h2 className="text-[17px] font-semibold mt-2 leading-snug">{wo.title}</h2>
                    {wo.assetId && (
                      <Link href={`/assets/${wo.assetId}`} className="inline-flex items-center gap-1 text-[12px] text-[var(--color-accent)] hover:underline mt-1">
                        {assetName || "View asset"} →
                      </Link>
                    )}
                  </div>
                </div>

                {/* Lifecycle actions */}
                <div className="flex flex-wrap gap-2 mt-4">
                  {(ACTIONS[wo.status] ?? []).map((a) =>
                    a.to === "done" ? (
                      <button
                        key={a.to}
                        disabled={busy}
                        onClick={() => { setActionError(null); setCloseOut(true); }}
                        className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[var(--color-green)] text-white hover:brightness-110 disabled:opacity-40"
                      >
                        {a.label}
                      </button>
                    ) : (
                      <button
                        key={a.to}
                        disabled={busy}
                        onClick={() => transition(a.to)}
                        className={`text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-40 ${
                          a.primary
                            ? "bg-[var(--color-accent)] text-white hover:brightness-110"
                            : "border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                        }`}
                      >
                        {a.label}
                      </button>
                    )
                  )}
                </div>
                {actionError && (
                  <p className="text-[12px] text-[var(--color-red)] mt-3" role="alert">{actionError}</p>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mt-5 border-b border-[var(--color-border)]">
                <TabBtn active={tab === "work"} onClick={() => setTab("work")}>Details</TabBtn>
                <TabBtn active={tab === "copilot"} onClick={() => setTab("copilot")}>Ask Copilot</TabBtn>
              </div>

              {tab === "work" ? (
                <div className="py-5 space-y-5">
                  {/* Lifecycle timeline facts */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <Fact label="Reported" value={fmt(wo.reportedAt ?? wo.createdAt)} />
                    <Fact label="Started" value={fmt(wo.startedAt)} />
                    <Fact label="Closed" value={fmt(wo.closedAt)} />
                    <Fact label="Downtime" value={wo.downtimeMins != null ? `${wo.downtimeMins} min` : "—"} highlight />
                  </div>

                  {wo.symptom && (
                    <Section title="Reported symptom">
                      <p className="text-[14px] leading-relaxed">{wo.symptom}</p>
                    </Section>
                  )}
                  {wo.resolution && (
                    <Section title="Resolution">
                      <p className="text-[14px] leading-relaxed">{wo.resolution}</p>
                    </Section>
                  )}

                  {wo.status === "done" && (
                    <div className="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">🤖</span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[13px] font-semibold">Should this become a PM?</h3>
                          <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                            Let the AI turn this repair into a grounded preventive program. You approve before it goes active.
                          </p>
                          {pmState !== "idle" && (
                            <p className={`text-[12px] mt-2 ${pmState === "error" ? "text-[var(--color-red)]" : "text-[var(--color-green)]"}`}>
                              {pmState === "loading" ? "Analyzing repair + history…" : pmMsg}
                            </p>
                          )}
                        </div>
                        {pmState === "done" ? (
                          <a href="/pm" className="shrink-0 text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110">
                            Review PM →
                          </a>
                        ) : (
                          <button
                            disabled={pmState === "loading"}
                            onClick={suggestPm}
                            className="shrink-0 text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
                          >
                            {pmState === "loading" ? "…" : "Suggest PM"}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Automated RCA — generate a formal root-cause analysis from
                      this closed corrective work order and its asset history. */}
                  {wo.status === "done" && wo.type === "corrective" && (
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">🧭</span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[13px] font-semibold">Generate a Root Cause Analysis</h3>
                          <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                            A formal RCA (problem, timeline, 5-Why, root cause, corrective
                            action, prevention) built from this work order and the asset&apos;s
                            failure history — grounded in recorded data, never invented.
                          </p>
                          {rcaMsg && (
                            <p className={`text-[12px] mt-2 ${rcaState === "error" ? "text-[var(--color-red)]" : "text-[var(--color-green)]"}`}>{rcaMsg}</p>
                          )}
                        </div>
                        <button
                          disabled={rcaState === "loading" || rcaState === "saving"}
                          onClick={() => generateRca(false)}
                          className="shrink-0 text-[12px] font-medium rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                        >
                          {rcaState === "loading" ? "Analyzing…" : "Generate RCA"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Maintenance Memory (Slice 4): the close-out is now indexed
                      as a retrievable lesson the Copilot can cite. Only shown
                      when there was real close-out content to capture. */}
                  {wo.status === "done" && wo.assetId && (wo.resolution || wo.rootCause || wo.failedPart) && (
                    <div className="rounded-xl border border-[var(--color-green)]/30 bg-[var(--color-green)]/5 p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">🧠</span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[13px] font-semibold">Saved to the machine&apos;s memory</h3>
                          <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                            This repair is now a retrievable lesson — the Copilot will surface it the next time {assetName || "this machine"} shows the same symptom.
                          </p>
                        </div>
                        <Link
                          href={`/assets/${wo.assetId}?tab=lessons`}
                          className="shrink-0 text-[12px] font-medium rounded-lg border border-[var(--color-green)]/40 text-[var(--color-green)] px-3 py-1.5 hover:bg-[var(--color-green)]/10"
                        >
                          View lessons →
                        </Link>
                      </div>
                    </div>
                  )}

                  <PartsIntegration wo={wo} />

                  {/* History timeline */}
                  <Section title="History">
                    {history.length === 0 ? (
                      <p className="text-[13px] text-[var(--color-muted)]">No activity recorded yet.</p>
                    ) : (
                      <ol className="relative border-l border-[var(--color-border)] ml-1.5 space-y-4">
                        {history.map((h) => (
                          <li key={h.id} className="ml-4">
                            <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[var(--color-accent)]" />
                            <p className="text-[13px]">
                              {h.kind === "status" && h.toStatus ? (
                                <>
                                  Moved to <span className="font-medium">{statusLabel[h.toStatus] ?? h.toStatus}</span>
                                </>
                              ) : h.kind === "created" ? (
                                "Work order created"
                              ) : h.kind === "assignment" ? (
                                h.note
                              ) : (
                                h.note ?? "Note"
                              )}
                            </p>
                            {h.note && h.kind === "status" && (
                              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">{h.note}</p>
                            )}
                            <p className="text-[11px] text-[var(--color-faint)] mt-0.5">
                              {fmt(h.at)} · {h.actor}
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </Section>
                </div>
              ) : (
                <div className="py-5">
                  <div className="h-[60vh] rounded-2xl border border-[var(--color-border)] overflow-hidden flex flex-col">
                    <Copilot
                      assetId={wo.assetId ?? undefined}
                      assetName={assetName || undefined}
                      seed={
                        wo.symptom
                          ? [{ id: `seed_${wo.id}`, role: "user", content: wo.symptom }]
                          : undefined
                      }
                    />
                  </div>
                  <p className="text-[11px] text-[var(--color-faint)] mt-2 px-1">
                    Answers are grounded in this asset’s documents and EAS’s pre-seeded OEM references, with citations. The Copilot advises — you make the call.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {closeOut && wo && (
        <CloseOutModal
          busy={busy}
          error={actionError}
          onClose={() => { if (!busy) { setActionError(null); setCloseOut(false); } }}
          onConfirm={async (d) => {
            const ok = await transition("done", {
              resolution: d.resolution,
              rootCause: d.rootCause,
              failedPart: d.failedPart,
              repairAction: d.repairAction,
              note: "Closed out",
            });
            // Only dismiss on success — on failure the modal stays open with the
            // error and the technician's typed close-out fully preserved.
            if (ok) setCloseOut(false);
          }}
        />
      )}

      {rca && (rcaState === "open" || rcaState === "saved" || rcaState === "saving" || rcaState === "error") && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end" onClick={() => setRcaState("idle")}>
          <div className="w-full sm:max-w-2xl h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-y-auto fadeup" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Root cause analysis">
            <div className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-5 py-3.5 flex items-center gap-3 z-10">
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold">Root Cause Analysis</h2>
                <p className="text-[11px] text-[var(--color-muted)]">
                  {rca.aiGenerated ? "AI-written analysis, grounded in evidence" : "Deterministic, grounded in recorded data"} · {rca.confidence} confidence
                </p>
              </div>
              <button
                disabled={rcaState === "saving" || rcaState === "saved"}
                onClick={() => generateRca(true)}
                className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-1.5 hover:brightness-110 disabled:opacity-50"
              >
                {rcaState === "saving" ? "Saving…" : rcaState === "saved" ? "Saved ✓" : "Save to Knowledge"}
              </button>
              <button onClick={() => setRcaState("idle")} aria-label="Close" className="text-[var(--color-faint)] hover:text-[var(--color-text)] text-lg">×</button>
            </div>
            <div className="px-6 py-5 text-[13.5px] leading-relaxed">
              <Markdown>{rca.markdown}</Markdown>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[13px] font-medium px-3.5 py-2 -mb-px border-b-2 transition ${
        active
          ? "border-[var(--color-accent)] text-[var(--color-text)]"
          : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Fact({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{label}</p>
      <p className={`text-[13px] font-medium mt-0.5 ${highlight ? "text-[var(--color-accent)]" : ""}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-2">{title}</h3>
      {children}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="h-4 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
        <div className="h-5 w-2/3 rounded bg-[var(--color-surface-2)] animate-pulse mt-3" />
        <div className="flex gap-2 mt-4">
          <div className="h-9 w-28 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
          <div className="h-9 w-20 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

export interface CloseOutData {
  resolution: string;
  rootCause: string;
  failedPart: string;
  repairAction: string;
}

function CloseOutModal({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (data: CloseOutData) => void;
}) {
  const [resolution, setResolution] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [failedPart, setFailedPart] = useState("");
  const [repairAction, setRepairAction] = useState("");

  // Esc closes the modal (unless a submit is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-end sm:place-items-center p-0 sm:p-4"
      onClick={() => { if (!busy) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Close out work order"
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-[15px] mb-1">Close out — capture the lesson</h2>
        <p className="text-[12px] text-[var(--color-muted)] mb-4">
          This becomes the machine’s memory and the evidence for a preventive
          maintenance recommendation. Only the resolution is required.
        </p>
        {error && (
          <div className="mb-3 rounded-lg border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-3 py-2 text-[12px] text-[var(--color-red)]" role="alert">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <Field label="What fixed it? (resolution) *">
            <textarea
              autoFocus
              placeholder="e.g. Panel cooling fan stalled; replaced fan, cleaned filter, verified current held steady."
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--color-accent)] resize-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Root cause">
              <input value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Bearing seizure" className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
            </Field>
            <Field label="Failed part">
              <input value={failedPart} onChange={(e) => setFailedPart(e.target.value)} placeholder="Drive-end bearing" className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
            </Field>
          </div>
          <Field label="Repair action">
            <input value={repairAction} onChange={(e) => setRepairAction(e.target.value)} placeholder="Replaced bearing, re-greased, aligned coupling" className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]" />
          </Field>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-[13px] px-3 py-2.5 sm:py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Cancel
          </button>
          <button
            disabled={busy || !resolution.trim()}
            onClick={() => onConfirm({ resolution: resolution.trim(), rootCause: rootCause.trim(), failedPart: failedPart.trim(), repairAction: repairAction.trim() })}
            className="text-[13px] font-medium px-4 py-2.5 sm:py-1.5 rounded-lg bg-[var(--color-green)] text-white disabled:opacity-40 hover:brightness-110"
          >
            {busy ? "Closing…" : "Mark done"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// Phase 4 — Parts Memory integration on the work order.
function PartsIntegration({ wo }: { wo: WorkOrder }) {
  const searchQ = (wo.failedPart || wo.symptom || wo.title || "").trim();
  const [desc, setDesc] = useState(wo.failedPart ?? "");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const addFailedPart = async () => {
    if (!desc.trim()) return;
    setState("saving");
    try {
      const res = await fetch(`/api/work-orders/${wo.id}/failed-part`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPart: { description: desc.trim() } }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Failed");
      const r = d.result;
      const tips = [
        r.suggestCriticalSpare ? "flagged as a candidate critical spare" : "",
        r.suggestPmInspection ? "consider a PM to inspect it" : "",
      ].filter(Boolean).join("; ");
      setMsg(`Added to Parts Memory (failed ${r.failureCount}×)${tips ? ` — ${tips}.` : "."}`);
      setState("done");
    } catch (e) {
      setMsg((e as Error).message);
      setState("error");
    }
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-2.5">Parts</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/parts${searchQ ? `?q=${encodeURIComponent(searchQ)}` : ""}`}
          className="text-[12.5px] font-medium rounded-lg border border-[var(--color-border)] px-3 py-1.5 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-2)]"
        >
          🔍 Find replacement part
        </Link>
      </div>

      {wo.status === "done" && (
        <div className="mt-3 border-t border-[var(--color-border-soft)] pt-3">
          <p className="text-[12px] text-[var(--color-muted)] mb-2">Add the failed part to Parts Memory — it builds this part's failure history and stocking suggestions.</p>
          {state === "done" ? (
            <p className="text-[12.5px] text-[var(--color-green)]">✓ {msg}</p>
          ) : (
            <div className="flex gap-2">
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Failed part (e.g. Drive-end bearing 6206-2RS)"
                className="flex-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
              />
              <button
                disabled={!desc.trim() || state === "saving"}
                onClick={addFailedPart}
                className="text-[12.5px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 disabled:opacity-40 hover:brightness-110"
              >
                {state === "saving" ? "Adding…" : "Add failed part"}
              </button>
            </div>
          )}
          {state === "error" && <p className="text-[12px] text-[var(--color-red)] mt-1.5">{msg}</p>}
        </div>
      )}
    </div>
  );
}
