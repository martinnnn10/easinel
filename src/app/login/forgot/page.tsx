"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid place-items-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold shadow-lg shadow-black/40">
            E
          </div>
          <div className="text-[15px] font-semibold tracking-tight">EAS Intelligence</div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
          <h1 className="text-[18px] font-semibold mb-2">Reset your password</h1>

          {sent ? (
            <div>
              <p className="text-[13px] text-[var(--color-muted)] mb-4">
                If an account exists for <strong>{email}</strong>, we&apos;ve sent a reset link.
                Check your email (or server logs in pilot mode).
              </p>
              <Link
                href="/login"
                className="text-[13px] font-medium text-[var(--color-accent)] hover:underline"
              >
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="text-[13px] text-[var(--color-muted)] mb-4">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full text-[13px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 mb-4 focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-2.5 hover:brightness-110 disabled:opacity-40"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
              <div className="mt-4 text-center">
                <Link
                  href="/login"
                  className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                >
                  ← Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
