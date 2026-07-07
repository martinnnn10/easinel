/**
 * Machine QR tags. A plant prints a small QR label for each machine and mounts
 * it on the equipment. A technician points their phone's camera at it and lands
 * directly on that machine's capture form (/field?asset=<id>) — pre-grounded,
 * no searching. The QR encodes an absolute deep link, so the phone's native
 * camera opens it; no special scanner or app install is required.
 *
 * The SVG is rendered here (from the encoder's module grid) so it is fully
 * self-contained — no external refs, no runtime library on the client, and it
 * prints crisply at any size.
 */

import qrcode from "qrcode-generator";

// The deep link a scanned tag resolves to. An unknown/foreign asset id simply
// won't match anything in the scanning user's org, so the id need not be secret.
export function assetTagUrl(base: string, assetId: string): string {
  const b = base.replace(/\/+$/, "");
  return `${b}/field?asset=${encodeURIComponent(assetId)}`;
}

export interface QrSvgOptions {
  size?: number; // rendered pixel size (square); default 160
  margin?: number; // quiet-zone modules; QR spec minimum is 4
}

// Render `text` as a self-contained QR SVG string. Medium error correction (M)
// balances density against tolerance for a scuffed shop-floor label.
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  if (!text) throw new Error("qrSvg() requires text");
  const qr = qrcode(0, "M"); // 0 = auto-size to the data
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const margin = opts.margin ?? 4;
  const dim = count + margin * 2;

  // One path for every dark module keeps the SVG compact and crisp.
  let d = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }

  const size = opts.size ?? 160;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<path d="${d}" fill="#000000"/>` +
    `</svg>`
  );
}
