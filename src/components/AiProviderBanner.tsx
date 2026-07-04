"use client";

import { useEffect, useState } from "react";

// Makes a silent AI fallback IMPOSSIBLE to miss: when no live LLM key is
// configured (e.g. ANTHROPIC_API_KEY=""), the Copilot runs the deterministic
// engine — and this slim amber strip says so, for admins / open-mode operators.
export function AiProviderBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let ok = true;
    Promise.all([
      fetch("/api/health").then((r) => r.json()).catch(() => null),
      fetch("/api/auth/me").then((r) => r.json()).catch(() => null),
    ]).then(([health, me]) => {
      if (!ok || !health) return;
      const notConfigured = health.aiProviderConfigured === false;
      const isAdminOrOpen =
        !me?.authRequired || me?.user?.role === "owner" || me?.user?.role === "admin";
      setShow(notConfigured && isAdminOrOpen);
    });
    return () => { ok = false; };
  }, []);

  if (!show || dismissed) return null;
  return (
    <div className="w-full bg-[var(--color-amber)]/10 border-b border-[var(--color-amber)]/30 px-4 py-1.5 flex items-center gap-2 text-[12px]">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-amber)]" />
      <span className="text-[var(--color-amber)] font-medium">Live AI provider not configured.</span>
      <span className="text-[var(--color-muted)]">
        Running deterministic fallback mode — set <code className="font-mono">ANTHROPIC_API_KEY</code> for full Copilot answers.
      </span>
      <button onClick={() => setDismissed(true)} className="ml-auto text-[var(--color-faint)] hover:text-[var(--color-text)]" aria-label="Dismiss">×</button>
    </div>
  );
}
