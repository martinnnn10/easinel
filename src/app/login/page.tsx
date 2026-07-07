"use client";

import { useEffect, useState } from "react";
import { resolveSafeNext } from "@/lib/safeRedirect";

type Mode = "loading" | "signin" | "signup";

// Resolve ?next= to a safe same-origin path (rejects absolute, protocol-relative,
// and backslash-normalized cross-origin targets) so it can't become an open redirect.
function safeNext(): string {
  return resolveSafeNext(new URLSearchParams(window.location.search).get("next"), window.location.origin);
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [oidc, setOidc] = useState(false);
  const [form, setForm] = useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          window.location.href = safeNext();
          return;
        }
        setOidc(Boolean(d.oidc));
        // No accounts yet → default to creating an organization. A ?signup=1
        // deep link (marketing "Start free trial" CTA) also lands on sign-up.
        const wantsSignup = new URLSearchParams(window.location.search).get("signup") === "1";
        setMode(!d.hasUsers || wantsSignup ? "signup" : "signin");
      })
      .catch(() => setMode("signin"));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (!res.ok) {
      setError(d.message || d.error || "Failed");
      setBusy(false);
      return;
    }
    window.location.href = safeNext();
  };

  const canSubmit =
    form.email &&
    form.password &&
    (mode === "signin" || form.orgName.trim().length > 0);

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold shadow-lg shadow-black/40">
            E
          </div>
          <div className="text-[15px] font-semibold tracking-tight">EAS Maintenance Intelligence</div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          {mode === "loading" ? (
            <p className="text-center text-[var(--color-muted)] text-sm">Loading…</p>
          ) : (
            <>
              <h1 className="text-[17px] font-semibold mb-1">
                {mode === "signup" ? "Create your organization" : "Sign in"}
              </h1>
              <p className="text-[12px] text-[var(--color-muted)] mb-5">
                {mode === "signup"
                  ? "Spin up your plant's workspace and become its owner."
                  : "Sign in to your organization's maintenance intelligence platform."}
              </p>

              {oidc && mode === "signin" && (
                <>
                  <a
                    href="/api/auth/oidc/start"
                    className="block text-center text-[13px] font-medium rounded-lg border border-[var(--color-border)] py-2.5 hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-surface-2)] transition mb-4"
                  >
                    Continue with SSO
                  </a>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-[var(--color-border)]" />
                    <span className="text-[11px] text-[var(--color-faint)]">or</span>
                    <div className="flex-1 h-px bg-[var(--color-border)]" />
                  </div>
                </>
              )}

              <div className="space-y-3">
                {mode === "signup" && (
                  <Field label="Organization" value={form.orgName} onChange={(v) => setForm({ ...form, orgName: v })} placeholder="Acme Foods — Plant 4" />
                )}
                {mode === "signup" && (
                  <Field label="Your name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Jane Operator" />
                )}
                <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@plant.com" />
                <Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="••••••••" onEnter={submit} />
              </div>

              {error && <p className="text-[12px] text-[var(--color-red)] mt-3">{error}</p>}

              <button
                onClick={submit}
                disabled={busy || !canSubmit}
                className="mt-5 w-full text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-2.5 hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "Please wait…" : mode === "signup" ? "Create organization" : "Sign in"}
              </button>

              {mode === "signin" && (
                <a
                  href="/login/forgot"
                  className="block mt-2 text-center text-[11px] text-[var(--color-faint)] hover:text-[var(--color-muted)] underline underline-offset-2"
                >
                  Forgot your password?
                </a>
              )}

              <button
                onClick={() => {
                  setError("");
                  setMode(mode === "signup" ? "signin" : "signup");
                }}
                className="mt-3 w-full text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                {mode === "signup"
                  ? "Already have an account? Sign in"
                  : "New here? Create an organization"}
              </button>
            </>
          )}
        </div>
        <p className="text-center text-[11px] text-[var(--color-faint)] mt-4">
          Multi-org · Role-based access
        </p>
        <p className="text-center text-[11px] mt-2">
          <a href="/" className="text-[var(--color-faint)] hover:text-[var(--color-muted)] underline underline-offset-2">
            ← Back to easmaint.com
          </a>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-faint)]"
      />
    </label>
  );
}
