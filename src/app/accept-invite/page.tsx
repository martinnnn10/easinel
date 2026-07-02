"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function AcceptInviteInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.email) {
          setInvite({ email: d.email, role: d.role });
          setState("ready");
        } else {
          setState("invalid");
        }
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/accept-invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...form }),
    });
    const d = await res.json();
    if (!res.ok) {
      setError(d.message || d.error || "Failed");
      setBusy(false);
      return;
    }
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold shadow-lg shadow-black/40">
            E
          </div>
          <div className="text-[15px] font-semibold tracking-tight">EAS Intelligence</div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          {state === "loading" ? (
            <p className="text-center text-[var(--color-muted)] text-sm">Loading invitation…</p>
          ) : state === "invalid" ? (
            <div className="text-center py-6">
              <p className="text-[15px] font-medium">Invitation not valid</p>
              <p className="text-[12px] text-[var(--color-muted)] mt-2">
                This invitation is invalid or has expired. Ask your administrator to send a new one.
              </p>
              <a href="/login" className="inline-block mt-5 text-[13px] text-[var(--color-accent)] hover:underline">
                Go to sign in
              </a>
            </div>
          ) : (
            <>
              <h1 className="text-[17px] font-semibold mb-1">Accept your invitation</h1>
              <p className="text-[12px] text-[var(--color-muted)] mb-5">
                You've been invited to join as{" "}
                <strong className="text-[var(--color-text)] capitalize">{invite?.role}</strong>. Set your
                name and password to continue.
              </p>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Email</span>
                  <input
                    value={invite?.email ?? ""}
                    disabled
                    className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-muted)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Your name</span>
                  <input
                    value={form.name}
                    placeholder="Jane Operator"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Password (8+ chars)</span>
                  <input
                    type="password"
                    value={form.password}
                    placeholder="••••••••"
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && form.password.length >= 8 && submit()}
                    className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
                  />
                </label>
              </div>

              {error && <p className="text-[12px] text-[var(--color-red)] mt-3">{error}</p>}

              <button
                onClick={submit}
                disabled={busy || form.password.length < 8}
                className="mt-5 w-full text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-2.5 hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "Joining…" : "Join organization"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteInner />
    </Suspense>
  );
}
