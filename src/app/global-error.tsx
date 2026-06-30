"use client";

// Last-resort boundary for errors thrown in the ROOT layout itself (where the
// normal error.tsx can't render because the layout is what failed). It must
// provide its own <html>/<body>. Deliberately dependency-free and inline-styled
// so it works even if the stylesheet or a provider is what broke.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui.global-error]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b0e13",
          color: "#e6e8eb",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>The app failed to load</h1>
          <p style={{ fontSize: 13, color: "#9aa3ad", marginTop: 8 }}>
            A critical error stopped the interface from rendering. Reloading usually fixes it.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 8, fontFamily: "monospace" }}>
              Ref: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#2f6fed",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
