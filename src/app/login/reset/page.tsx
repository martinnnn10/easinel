"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || "Reset failed. The link may have expired.");
    } else {
      setDone(true);
    }
    setLoading(false);
  };

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-[14px] text-[var(--color-muted)] mb-4">
          Invalid or missing reset token.
        </p>
        <Link href="/login/forgot" className="text-[13px] font-medium text-[var(--color-accent)] hover:underline">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="flex items-center gap-2.5 justify-center mb-8">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold shadow-lg shadow-black/40">
          E
        </div>
        <div className="text-[15px] font-semibold tracking-tight">EAS Intelligence</div>
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="text-[18px] font-semibold mb-2">Set new password</h1>

        {done ? (
          <div>
            <p className="text-[13px] text-[var(--color-muted)] mb-4">
              Your password has been reset. You can now sign in.
            </p>
            <Link
              href="/login"
              className="inline-block w-full text-center text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-2.5 hover:brightness-110"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (8+ characters)"
              required
              minLength={8}
              className="w-full text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 mb-3 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              required
              minLength={8}
              className="w-full text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 mb-4 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            {error && <p className="text-[12px] text-[var(--color-red)] mb-3">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-2.5 hover:brightness-110 disabled:opacity-40"
            >
              {loading ? "Resetting\u2026" : "Reset password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen grid place-items-center bg-[var(--color-bg)] px-4">
      <Suspense fallback={<div className="text-[var(--color-muted)] text-sm">Loading…</div>}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
