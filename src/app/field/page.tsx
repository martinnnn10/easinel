"use client";

// ─────────────────────────────────────────────────────────────────────────
// /field — the at-the-machine capture view. A full-screen, mobile-first,
// thumb-reachable flow for a technician standing next to a machine with dirty
// hands: pick the machine, speak the symptom, set priority, (optionally) snap a
// photo, and log it — or log-and-ask the asset-grounded Copilot in one tap.
//
// Reuses the same real endpoints as the desktop modal (POST /api/work-orders,
// /api/work-orders/recurrence, /api/assets, /api/assets/{id}/photos), so nothing
// is fabricated and the daily loop stays consistent.
// ─────────────────────────────────────────────────────────────────────────

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useDictation } from "@/lib/voice";
import {
  submitCapture,
  flushCaptures,
  getCaptureStore,
  OfflineError,
  type FieldCapture,
} from "@/lib/field/offlineQueue";

interface Asset {
  id: string;
  name: string;
  assetTag?: string | null;
  area?: string | null;
  line?: string | null;
  status?: string | null;
}
interface PriorFix {
  count: number;
  label: string;
  last: { id: string; number: string | null; fix: string } | null;
}

const PRIORITIES: { key: string; label: string; color: string }[] = [
  { key: "urgent", label: "Urgent — line down", color: "var(--color-red)" },
  { key: "high", label: "High", color: "var(--color-amber)" },
  { key: "medium", label: "Medium", color: "var(--color-accent)" },
  { key: "low", label: "Low", color: "var(--color-faint)" },
];

export default function FieldPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-bg)]" />}>
      <FieldCapture />
    </Suspense>
  );
}

function FieldCapture() {
  const router = useRouter();
  const params = useSearchParams();
  const presetAsset = params.get("asset") || "";

  const [assets, setAssets] = useState<Asset[]>([]);
  const [search, setSearch] = useState("");
  const [assetId, setAssetId] = useState<string>(presetAsset);
  const [symptom, setSymptom] = useState("");
  const [priority, setPriority] = useState("medium");
  const [photo, setPhoto] = useState<File | null>(null);
  const [priorFix, setPriorFix] = useState<PriorFix | null>(null);
  const [submitting, setSubmitting] = useState<null | "log" | "ask">(null);
  const [err, setErr] = useState<string | null>(null);
  // Offline resilience: track connectivity, how many captures are waiting on the
  // device, and a one-shot confirmation after a capture is saved offline.
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [savedOffline, setSavedOffline] = useState(false);

  useEffect(() => {
    fetch("/api/assets")
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((d) => setAssets(d.assets ?? []))
      .catch(() => {});
  }, []);

  // Drain any device-queued captures to the server, then refresh the count.
  const flush = useCallback(async () => {
    try {
      const store = getCaptureStore();
      const { remaining } = await flushCaptures(store);
      setPending(remaining);
    } catch {
      /* best-effort — the queue stays on the device for the next attempt */
    }
  }, []);

  // Connectivity: seed from the browser, then react to online/offline. Coming
  // back online triggers an automatic flush so a tech never has to think about it.
  useEffect(() => {
    setOnline(navigator.onLine);
    getCaptureStore().list().then((c) => setPending(c.length)).catch(() => {});
    if (navigator.onLine) flush();
    const goOnline = () => { setOnline(true); flush(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flush]);

  const selected = useMemo(() => assets.find((a) => a.id === assetId) ?? null, [assets, assetId]);

  // A photo is taken for a specific machine; if the machine changes (or is
  // cleared), drop it so it can never be mis-attributed to another asset.
  useEffect(() => {
    setPhoto(null);
  }, [assetId]);

  // "Have we seen this before?" — the exact recurrence lookup the desktop modal
  // uses. Debounced, real closed-corrective prior fixes only.
  useEffect(() => {
    const s = symptom.trim();
    if (s.length < 6) {
      setPriorFix(null);
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/work-orders/recurrence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symptom: s, assetId: assetId || null }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPriorFix(d?.priorFix ?? null))
        .catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [symptom, assetId]);

  // Voice-first symptom entry.
  const appendSymptom = (t: string) => setSymptom((s) => (s ? s + " " : "") + t);
  const { listening, supported, toggle } = useDictation(appendSymptom);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = assets.filter((a) => a.status !== "retired");
    if (!q) return pool.slice(0, 8);
    return pool
      .filter((a) => [a.name, a.assetTag, a.area, a.line].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .slice(0, 12);
  }, [assets, search]);

  // Reset the form for the next capture (a tech at a machine may log several in
  // a row, especially while offline). Keeps nothing that could mis-attribute.
  const resetForNext = () => {
    setSymptom("");
    setPhoto(null);
    setPriority("medium");
    setPriorFix(null);
    setSubmitting(null);
  };

  // Save the capture on the device and surface an honest "waiting to sync" state.
  const queueOffline = async (capture: FieldCapture, mode: "log" | "ask") => {
    try {
      await getCaptureStore().add(capture);
      setPending((n) => n + 1);
      setSavedOffline(true);
      setErr(
        mode === "ask"
          ? "Saved on your phone — Copilot needs a connection, so ask once you're back online."
          : null
      );
      resetForNext();
    } catch {
      // Couldn't even persist locally (private mode / no IndexedDB). Be honest —
      // do NOT pretend the capture is safe.
      setErr("Couldn't save this capture on your device. Please try again once you have a connection.");
      setSubmitting(null);
    }
  };

  const submit = async (mode: "log" | "ask") => {
    if (!symptom.trim() || submitting) return;
    setSubmitting(mode);
    setErr(null);
    setSavedOffline(false);

    const capture: FieldCapture = {
      id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      symptom: symptom.trim(),
      assetId: assetId || null,
      assetName: selected?.name ?? null,
      priority,
      photo,
      photoName: photo?.name ?? null,
      createdAt: Date.now(),
    };

    // Offline up front → queue without a doomed round-trip.
    if (!navigator.onLine) {
      await queueOffline(capture, mode);
      return;
    }

    try {
      const woId = await submitCapture(capture);
      if (mode === "ask") {
        const q = encodeURIComponent(capture.symptom);
        router.push(assetId ? `/copilot?asset=${encodeURIComponent(assetId)}&ask=${q}` : `/copilot?ask=${q}`);
      } else {
        router.push(woId ? `/work-orders/${woId}` : "/work-orders");
      }
    } catch (e) {
      // A network failure mid-submit is a dead zone, not a real error — save it
      // rather than lose it. A genuine server rejection is surfaced as an error.
      if (e instanceof OfflineError) {
        await queueOffline(capture, mode);
      } else {
        setErr((e as Error).message || "Couldn't log the work order.");
        setSubmitting(null);
      }
    }
  };

  return (
    // Dynamic viewport height (not 100vh) so the sticky footer with the primary
    // CTAs stays visible above the mobile browser toolbar.
    <div className="h-[100dvh] min-h-[100svh] bg-[var(--color-bg)] flex flex-col">
      {/* Minimal top strip (no app chrome on this route) */}
      <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur border-b border-[var(--color-border)]">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/today" className="text-[var(--color-muted)] text-[22px] leading-none -ml-1 px-1" aria-label="Back">←</Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-[16px] font-semibold leading-tight">Report a problem</h1>
            <p className="text-[11px] text-[var(--color-faint)] leading-tight">At the machine — log it in seconds</p>
          </div>
          {/* Live connectivity chip — a tech in a dead zone sees why, and knows
              their captures are safe. */}
          {!online && (
            <span className="shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--color-amber)]/12 text-[var(--color-amber)] text-[11px] font-semibold px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" /> Offline
            </span>
          )}
        </div>
      </header>

      {/* Offline / pending-sync status — honest about where each capture lives. */}
      {(!online || pending > 0) && (
        <div className="bg-[var(--color-amber)]/8 border-b border-[var(--color-amber)]/20">
          <div className="max-w-xl mx-auto px-4 py-2 text-[12px] text-[var(--color-amber)] flex items-center gap-2">
            <span>{online ? "🔄" : "📴"}</span>
            <span className="flex-1">
              {online
                ? `Syncing ${pending} saved capture${pending === 1 ? "" : "s"}…`
                : pending > 0
                ? `You're offline. ${pending} capture${pending === 1 ? "" : "s"} saved on this phone — they'll sync automatically when you're back online.`
                : "You're offline. Captures are saved on this phone and sync automatically when you're back online."}
            </span>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-5 space-y-6 pb-40">
          {/* 1 — Machine */}
          <section>
            <SectionLabel n={1}>Which machine?</SectionLabel>
            {selected ? (
              <div className="flex items-center gap-3 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-3.5">
                <div className="w-9 h-9 rounded-lg bg-[var(--color-surface-2)] grid place-items-center text-[var(--color-accent)] shrink-0">🛠️</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold truncate">{selected.name}</p>
                  <p className="text-[12px] text-[var(--color-muted)] truncate">
                    {[selected.assetTag, selected.area, selected.line].filter(Boolean).join(" · ") || "Selected"}
                  </p>
                </div>
                <button onClick={() => setAssetId("")} className="text-[13px] text-[var(--color-accent)] px-2 py-2">Change</button>
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, tag, or area…"
                  className="w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3 text-[15px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)]"
                />
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {filtered.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { setAssetId(a.id); setSearch(""); }}
                      className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left hover:border-[var(--color-accent)]/50 active:bg-[var(--color-surface-2)]"
                    >
                      <span className="text-lg shrink-0">⚙️</span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium truncate">{a.name}</span>
                        <span className="block text-[11px] text-[var(--color-faint)] truncate">{[a.assetTag, a.area, a.line].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                    </button>
                  ))}
                  {assets.length === 0 && (
                    <p className="text-[13px] text-[var(--color-muted)] px-1 py-2">
                      No machines yet. <Link href="/assets" className="text-[var(--color-accent)] underline">Add one</Link> — or log without a machine below.
                    </p>
                  )}
                </div>
                <button onClick={() => setAssetId("")} className="mt-2 text-[12px] text-[var(--color-faint)]">Skip — not sure which machine</button>
              </>
            )}
          </section>

          {/* 2 — Symptom (voice-first) */}
          <section>
            <SectionLabel n={2}>What&apos;s wrong?</SectionLabel>
            {supported && (
              <button
                onClick={toggle}
                className={`w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 text-[16px] font-semibold transition ${
                  listening
                    ? "bg-[var(--color-red)] text-white animate-pulse"
                    : "bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:brightness-110"
                }`}
              >
                <MicGlyph />
                {listening ? "Listening… tap to stop" : "Hold the phone up — tap to speak"}
              </button>
            )}
            <textarea
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
              rows={3}
              placeholder={supported ? "…or type it here" : "Describe what's happening — e.g. “F007 overload, trips after 10 min”"}
              className="mt-2 w-full rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3 text-[15px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)] resize-none"
            />

            {/* "Seen before?" — real prior fix */}
            {priorFix?.last && (
              <Link
                href={`/work-orders/${priorFix.last.id}`}
                className="mt-2 block rounded-xl border border-[var(--color-amber)]/40 bg-[var(--color-amber)]/5 p-3"
              >
                <p className="text-[12px] font-semibold text-[var(--color-amber)]">
                  🔁 Seen before — {priorFix.count}× {assetId ? "on this machine" : "elsewhere in your plant"}
                  {priorFix.label ? ` · ${priorFix.label}` : ""}
                </p>
                <p className="text-[13px] text-[var(--color-text)] mt-0.5">
                  {priorFix.last.fix ? `Last fix: ${priorFix.last.fix}` : "Open the prior repair →"}
                </p>
              </Link>
            )}
          </section>

          {/* 3 — Priority */}
          <section>
            <SectionLabel n={3}>How urgent?</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPriority(p.key)}
                  className={`rounded-xl border py-3 text-[14px] font-medium transition ${
                    priority === p.key
                      ? "border-transparent text-white"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                  }`}
                  style={priority === p.key ? { background: p.color } : undefined}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          {/* 4 — Photo (optional) */}
          <section>
            <SectionLabel n={4} optional>Add a photo</SectionLabel>
            <label className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-3.5 cursor-pointer active:bg-[var(--color-surface-2)]">
              <span className="text-2xl">📷</span>
              <span className="text-[13px] text-[var(--color-muted)] flex-1">
                {photo ? photo.name : selected ? `Snap the fault — attaches to ${selected.name}` : "Pick a machine first to attach a photo"}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={!selected}
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </section>

        </div>
      </main>

      {/* Sticky submit bar — thumb height, padded past the iOS home indicator */}
      <footer
        className="shrink-0 bg-[var(--color-bg)]/95 backdrop-blur border-t border-[var(--color-border)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Error surfaces here (adjacent to the buttons) so a failed tap is never
            explained only by off-screen text. */}
        {err && <p className="max-w-xl mx-auto px-4 pt-2 text-[13px] text-[var(--color-red)]">{err}</p>}
        {savedOffline && !err && (
          <p className="max-w-xl mx-auto px-4 pt-2 text-[13px] text-[var(--color-green)]">
            ✓ Saved on your phone. It&apos;ll sync automatically when you&apos;re back online — you can log the next one.
          </p>
        )}
        <div className="max-w-xl mx-auto px-4 py-3 flex gap-2.5">
          <button
            onClick={() => submit("log")}
            disabled={!symptom.trim() || submitting !== null}
            className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3.5 text-[15px] font-medium disabled:opacity-40 active:bg-[var(--color-surface-2)]"
          >
            {submitting === "log" ? (online ? "Logging…" : "Saving…") : online ? "Log it" : "Save on phone"}
          </button>
          <button
            onClick={() => submit("ask")}
            disabled={!symptom.trim() || submitting !== null}
            className="flex-1 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] py-3.5 text-[15px] font-semibold disabled:opacity-40 hover:brightness-110"
          >
            {submitting === "ask" ? "Opening…" : "Log & ask Copilot"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function SectionLabel({ n, children, optional }: { n: number; children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-5 h-5 rounded-full bg-[var(--color-surface-2)] grid place-items-center text-[11px] font-semibold text-[var(--color-muted)]">{n}</span>
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{children}</h2>
      {optional && <span className="text-[11px] text-[var(--color-faint)]">optional</span>}
    </div>
  );
}

function MicGlyph() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}
