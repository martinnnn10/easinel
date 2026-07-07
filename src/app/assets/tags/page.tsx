// Printable machine QR tags. A manager prints these, mounts one on each machine,
// and a technician scans it with their phone camera to jump straight to that
// machine's capture form. Server-rendered so the QR SVGs are inlined and print
// crisply; the only client bit is the Print button.

import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { can, type Role } from "@/lib/auth/roles";
import { listAssets, getAsset } from "@/lib/assets/repository";
import { assetTagUrl, qrSvg } from "@/lib/qr/tag";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

// The origin the printed QR should point at — the real host serving the app,
// falling back to the configured base URL.
async function resolveBase(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  return (process.env.APP_BASE_URL || "https://easmaint.com").replace(/\/+$/, "");
}

export default async function AssetTagsPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/assets/tags");
  if (!can(user.role as Role, "manage_assets")) redirect("/assets");

  const { only } = await searchParams;
  const base = await resolveBase();

  // One tag, or the whole plant (retired machines excluded — you don't tag those).
  const assets = only
    ? [await getAsset(user.orgId, only)].filter((a): a is NonNullable<typeof a> => Boolean(a))
    : (await listAssets(user.orgId)).filter((a) => a.status !== "retired");

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Toolbar — hidden when printing */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-3">
          <Link href="/assets" className="text-neutral-500 text-[22px] leading-none -ml-1 px-1" aria-label="Back">←</Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-tight text-neutral-900">Machine QR tags</h1>
            <p className="text-[11px] text-neutral-500 leading-tight">
              Print, then mount one on each machine. Scanning it opens that machine&apos;s report form.
            </p>
          </div>
          {assets.length > 0 && <PrintButton />}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-6">
        {assets.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-neutral-300 rounded-2xl">
            <div className="text-3xl mb-3">🏷️</div>
            <p className="text-[15px] font-medium text-neutral-900">No machines to tag yet</p>
            <p className="text-neutral-500 text-sm mt-1">
              Add your equipment first, then print a scannable tag for each one.{" "}
              <Link href="/assets" className="underline">Go to Machines</Link>
            </p>
          </div>
        ) : (
          <>
            <p className="print:hidden text-[12px] text-neutral-500 mb-4">
              {assets.length} tag{assets.length === 1 ? "" : "s"} · point a phone camera at any tag to open its capture form.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 print:grid-cols-3 print:gap-3">
              {assets.map((a) => {
                const url = assetTagUrl(base, a.id);
                const svg = qrSvg(url, { size: 200 }); // default 4-module quiet zone for reliable scanning
                const sub = [a.assetTag, a.area, a.line].filter(Boolean).join(" · ");
                return (
                  <div
                    key={a.id}
                    className="break-inside-avoid rounded-xl border border-neutral-300 p-3 flex flex-col items-center text-center bg-white"
                  >
                    <div
                      className="w-full aspect-square max-w-[200px] mx-auto"
                      // Self-contained inline SVG — no external refs.
                      dangerouslySetInnerHTML={{ __html: svg }}
                    />
                    <p className="mt-2 text-[13px] font-semibold text-neutral-900 leading-tight break-words w-full">{a.name}</p>
                    {sub && <p className="text-[10.5px] text-neutral-500 leading-tight break-words w-full">{sub}</p>}
                    <p className="mt-1 text-[9px] text-neutral-400 tracking-wide">Scan to report a problem</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
