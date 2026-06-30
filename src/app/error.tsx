"use client";

// Route-segment error boundary. Any uncaught render/runtime error inside the app
// shell lands here instead of a blank screen — the operator gets a clear message
// and a one-click retry, and the error is logged to the console for support.
// (Next.js requires this to be a Client Component with a `reset` action.)

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console / error pipeline. The `digest` correlates to
    // the server-side log line for this error.
    console.error("[ui.error]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="grid place-items-center h-full p-6 text-center">
      <div className="max-w-md">
        <div className="text-3xl mb-3">⚠️</div>
        <h1 className="text-[17px] font-semibold">Something went wrong</h1>
        <p className="text-[13px] text-[var(--color-muted)] mt-2">
          This screen hit an unexpected error. Your data is safe — nothing was lost.
          You can retry, or head back to the dashboard.
        </p>
        {error.digest && (
          <p className="text-[11px] text-[var(--color-faint)] mt-2 font-mono">
            Ref: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-2 mt-5">
          <button
            onClick={reset}
            className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:brightness-110"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
