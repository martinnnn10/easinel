"use client";

// Shared print-dialog trigger for server-rendered printable pages (asset tags,
// reliability report). Hidden on the printout itself via the page's print CSS.
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="shrink-0 rounded-lg bg-neutral-900 text-white text-[13px] font-medium px-4 py-2 hover:bg-neutral-700"
    >
      {label}
    </button>
  );
}
