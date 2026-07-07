"use client";

// Tiny client island so the server-rendered tag sheet can trigger the browser
// print dialog. (Print CSS in the page hides the toolbar for the printout.)
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="shrink-0 rounded-lg bg-neutral-900 text-white text-[13px] font-medium px-4 py-2 hover:bg-neutral-700"
    >
      Print
    </button>
  );
}
