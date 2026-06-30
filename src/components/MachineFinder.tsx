"use client";

// ─────────────────────────────────────────────────────────────────────────
// "What machine are you working on?" — the asset-first entry point.
//
// Maintenance starts at the machine. This hero lets a tech identify the asset
// the way they actually can in the field: type an asset/serial/model number,
// scan a QR/barcode (camera, when the browser supports BarcodeDetector), or snap
// the nameplate (read by the vision model when live). It then disambiguates
// ("I found N possible machines — which one?") and, if the machine is genuinely
// new, lets them create it on the spot — because nothing exists without a machine.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Candidate {
  asset: { id: string; name: string; assetTag: string | null; manufacturer?: string | null; model?: string | null };
  confidence: number;
  why: string;
}
interface IdentifyResult {
  bestMatch: Candidate | null;
  candidates: Candidate[];
  newAssetDraft: {
    name: string;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    assetType: string | null;
  };
  suggestedNumber: string;
  identity: { manufacturer: string | null; model: string | null; serialNumber: string | null; assetType: string | null; text: string | null };
  method: string;
  note: string;
}

const SEARCH_BY = ["Asset number", "Serial number", "Model number", "Machine name"];

// Minimal structural type for the experimental BarcodeDetector API (Chromium).
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

export function MachineFinder({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (q: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [placeholder, setPlaceholder] = useState("Asset number, serial, model, or name…");

  const [identifying, setIdentifying] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);

  // ── Photo / QR identify ──────────────────────────────────────────────
  const identify = useCallback(
    async (payload: { text?: string; file?: File }) => {
      setIdentifying(true);
      setMsg("");
      setResult(null);
      try {
        let res: Response;
        if (payload.file) {
          const fd = new FormData();
          fd.append("file", payload.file);
          res = await fetch("/api/assets/identify", { method: "POST", body: fd });
        } else {
          res = await fetch("/api/assets/identify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: payload.text ?? "" }),
          });
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Identification failed");
        setResult(data as IdentifyResult);
      } catch (e) {
        setMsg((e as Error).message);
      } finally {
        setIdentifying(false);
      }
    },
    []
  );

  const createFromDraft = async () => {
    if (!result) return;
    setCreating(true);
    setMsg("");
    try {
      const r = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: result.newAssetDraft.name,
          assetTag: result.suggestedNumber,
          manufacturer: result.newAssetDraft.manufacturer,
          model: result.newAssetDraft.model,
          serialNumber: result.newAssetDraft.serialNumber,
          assetType: result.newAssetDraft.assetType,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || "Create failed");
      const newId = d.asset?.id ?? d.id;
      if (newId) router.push(`/assets/${newId}`);
    } catch (e) {
      setMsg((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-gradient-to-b from-[var(--color-surface-2)]/60 to-[var(--color-surface)] p-5 mb-5">
      <h2 className="text-[18px] font-semibold tracking-tight">What machine are you working on?</h2>
      <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
        Start at the machine. Search, scan a QR, or snap the nameplate — then repair, inspect, create a PM, or view history.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.trim()) identify({ text: search.trim() });
            }}
            placeholder={placeholder}
            className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] pl-9 pr-3 py-2.5 text-[14px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)]"
          />
          <svg className="w-4 h-4 absolute left-3 top-3 text-[var(--color-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        </div>
        <QrScanButton onValue={(v) => { onSearch(v); identify({ text: v }); }} onError={setMsg} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={identifying}
          className="flex items-center gap-1.5 text-[13px] font-medium rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 hover:border-[var(--color-accent)]/60 disabled:opacity-50"
        >
          <CameraIcon /> Take a picture
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) identify({ file: f }); if (fileRef.current) fileRef.current.value = ""; }}
        />
      </div>

      {/* Search-by hints */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-[var(--color-faint)] uppercase tracking-wide">Search by</span>
        {SEARCH_BY.map((s) => (
          <button
            key={s}
            onClick={() => { setPlaceholder(`${s}…`); inputRef.current?.focus(); }}
            className="text-[11px] rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/50"
          >
            {s}
          </button>
        ))}
      </div>

      {identifying && <p className="text-[12px] text-[var(--color-muted)] mt-3">Identifying machine…</p>}
      {msg && <p className="text-[12px] text-[var(--color-amber)] mt-3">{msg}</p>}

      {/* Disambiguation / result */}
      {result && (
        <div className="mt-4 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-3">
          <p className="text-[13px] font-medium text-[var(--color-text)]">{result.note}</p>
          {result.candidates.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {result.candidates.map((c) => (
                <li key={c.asset.id}>
                  <Link
                    href={`/assets/${c.asset.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 hover:border-[var(--color-accent)]/60"
                  >
                    <span className="min-w-0">
                      <span className="text-[13px] font-medium truncate">✓ {c.asset.name}</span>
                      {c.asset.assetTag && <span className="ml-2 text-[11px] font-mono text-[var(--color-faint)]">{c.asset.assetTag}</span>}
                      <span className="block text-[11px] text-[var(--color-muted)]">{Math.round(c.confidence * 100)}% · {c.why}</span>
                    </span>
                    <span className="text-[12px] text-[var(--color-accent)] shrink-0">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {/* Create-new path — a machine that isn't on file yet */}
          {(result.identity.manufacturer || result.identity.model || result.identity.serialNumber || result.identity.text) && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={createFromDraft}
                disabled={creating}
                className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-2 hover:brightness-110 disabled:opacity-50"
              >
                {creating ? "Creating…" : result.candidates.length ? "None of these — create new machine" : "Create this machine"}
              </button>
              <span className="text-[11px] text-[var(--color-faint)]">
                {result.newAssetDraft.name} · {result.suggestedNumber}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Live QR/barcode scanner using the browser's BarcodeDetector (Chromium). Opens
// the rear camera in an overlay and resolves on the first decode. Degrades with
// a clear message where the API is unavailable (e.g. Safari) — never silently.
function QrScanButton({ onValue, onError }: { onValue: (v: string) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOpen(false);
  }, []);

  const start = useCallback(async () => {
    const w = window as unknown as { BarcodeDetector?: new (o?: unknown) => BarcodeDetectorLike };
    if (!w.BarcodeDetector) {
      onError("This browser can't scan QR codes. Type the asset/serial number, or take a picture of the nameplate.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onError("Camera access isn't available here. Type the number or take a picture instead.");
      return;
    }
    setOpen(true);
    try {
      const detector = new w.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length && codes[0].rawValue) {
            const value = codes[0].rawValue.trim();
            stop();
            onValue(value);
            return;
          }
        } catch {
          /* transient decode error — keep scanning */
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      onError("Couldn't open the camera. Type the number or take a picture instead.");
      stop();
    }
  }, [onError, onValue, stop]);

  useEffect(() => () => stop(), [stop]);

  return (
    <>
      <button
        onClick={start}
        className="flex items-center gap-1.5 text-[13px] font-medium rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 hover:border-[var(--color-accent)]/60"
      >
        <QrIcon /> Scan QR
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4" onClick={stop}>
          <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <video ref={videoRef} className="w-full rounded-xl border border-[var(--color-border)]" muted playsInline />
            <div className="absolute inset-6 border-2 border-white/70 rounded-lg pointer-events-none" />
            <p className="text-center text-white/80 text-[12px] mt-3">Point at the machine's QR / barcode label</p>
            <button onClick={stop} className="mt-3 mx-auto block text-[13px] rounded-lg bg-white/10 text-white px-4 py-2 hover:bg-white/20">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

function CameraIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
}
function QrIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M21 21v.01M17 21h.01M21 17h.01"/></svg>;
}
