import Link from "next/link";

// Friendly 404 for unknown routes (and explicit notFound() calls) — keeps the
// operator inside the app instead of dropping a bare browser error page.
export default function NotFound() {
  return (
    <div className="grid place-items-center h-full p-6 text-center">
      <div className="max-w-md">
        <div className="text-3xl mb-3">🧭</div>
        <h1 className="text-[17px] font-semibold">Page not found</h1>
        <p className="text-[13px] text-[var(--color-muted)] mt-2">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <Link
          href="/"
          className="inline-block mt-5 text-[13px] font-medium px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:brightness-110"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
