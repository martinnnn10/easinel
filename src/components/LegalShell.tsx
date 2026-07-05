import Link from "next/link";

// Shared layout for the public legal pages (/privacy, /terms) — plain,
// readable, no app chrome.
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-14">
        <Link href="/" className="text-[12px] text-[var(--color-faint)] hover:text-[var(--color-muted)]">
          ← easmaint.com
        </Link>
        <h1 className="text-[28px] font-semibold tracking-tight mt-3">{title}</h1>
        <p className="text-[12px] text-[var(--color-faint)] mt-1">Last updated {updated}</p>
        <div className="mt-8 space-y-1">{children}</div>
      </div>
    </div>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[15px] font-semibold mt-7 mb-1.5">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13.5px] leading-relaxed text-[var(--color-muted)]">{children}</p>;
}
