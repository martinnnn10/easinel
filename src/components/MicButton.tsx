"use client";

import { useDictation } from "@/lib/voice";

// A small push-to-talk mic for text fields — gloved/greasy hands at a live panel
// can't always type. Reuses the same Web Speech dictation the Copilot composer
// uses, and honestly renders nothing where the browser doesn't support it.
export function MicButton({ onText, title = "Dictate" }: { onText: (t: string) => void; title?: string }) {
  const { listening, supported, toggle } = useDictation(onText);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title={listening ? "Stop dictation" : title}
      aria-label={listening ? "Stop dictation" : title}
      className={`grid place-items-center w-7 h-7 rounded-lg border transition ${
        listening
          ? "border-[var(--color-red)] text-[var(--color-red)] bg-[var(--color-red)]/10 animate-pulse"
          : "border-[var(--color-border)] text-[var(--color-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
      </svg>
    </button>
  );
}
