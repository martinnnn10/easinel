// ─────────────────────────────────────────────────────────────────────────
// Security response headers (OWASP Secure Headers baseline).
//
// Applied to EVERY response from middleware so the whole surface — pages, API,
// static — is covered uniformly. Edge-safe: this module reads only process.env
// and returns a plain map (no Node APIs), so it runs in the middleware runtime.
//
// What each header buys us:
//   • Strict-Transport-Security — force HTTPS for a year incl. subdomains
//     (harmless over plain HTTP in dev; enforced once served over TLS).
//   • X-Content-Type-Options: nosniff — stop MIME-type confusion attacks.
//   • X-Frame-Options + frame-ancestors — clickjacking protection.
//   • Referrer-Policy — never leak full URLs (which can carry ids) cross-origin.
//   • Permissions-Policy — deny powerful features by default; allow camera to
//     SELF only (the QR / nameplate scanner needs it), mic/geo fully off.
//   • Cross-Origin-Opener-Policy — isolate the browsing context.
//   • X-DNS-Prefetch-Control: off — don't leak browsing intent via DNS.
//
// Content-Security-Policy is OPT-IN via CSP_ENABLED=true. A strict CSP can break
// a Next.js app's inline runtime, so it ships off-by-default and is tunable;
// when enabled it still permits what the framework needs while locking framing
// and base-uri down. Turn it on once you've validated it against your build.
//
// FRAMING EXCEPTION: a small set of routes serve our OWN stored files (e.g. the
// original uploaded PDF/image behind /api/knowledge/:id/file) which the app
// embeds inline in an <iframe>/<img> inside its own Knowledge panel. A blanket
// `X-Frame-Options: DENY` (and CSP `frame-ancestors 'none'`) forbids even
// same-origin framing, so those files render as a broken-file icon. For these
// routes ONLY we relax framing to SAME-ORIGIN — external sites still cannot
// frame the app (clickjacking protection intact), but our own first-party UI
// can embed the file it just served.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the security headers map.
 *
 * @param opts.allowSameOriginFrame when true, framing is relaxed from DENY /
 *   'none' to SAMEORIGIN / 'self' so the app's own pages can embed the response
 *   in an iframe. Cross-origin framing remains blocked either way.
 */
export function securityHeaders(
  opts: { allowSameOriginFrame?: boolean } = {}
): Record<string, string> {
  const frameSameOrigin = opts.allowSameOriginFrame === true;
  const headers: Record<string, string> = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": frameSameOrigin ? "SAMEORIGIN" : "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    "X-Permitted-Cross-Domain-Policies": "none",
  };

  if (process.env.CSP_ENABLED === "true") {
    headers["Content-Security-Policy"] = buildCsp(frameSameOrigin);
  }
  return headers;
}

// A pragmatic CSP: self-hosted by default, allows the inline styles/scripts a
// Next.js build emits, data/blob images (photo capture previews), and HTTPS
// connections for the configured AI/storage backends. Framing is forbidden by
// default; relaxed to 'self' only for first-party file-serving routes.
function buildCsp(frameSameOrigin = false): string {
  const connectExtra = (process.env.CSP_CONNECT_SRC ?? "").trim();
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    `frame-ancestors ${frameSameOrigin ? "'self'" : "'none'"}`,
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src 'self' https:${connectExtra ? " " + connectExtra : ""}`,
  ];
  return directives.join("; ");
}

// Whether a request path serves first-party files the app embeds inline and so
// should be allowed to be framed by its own same-origin pages. Kept as a pure
// path test so it is safe to call from the edge middleware runtime.
export function pathAllowsSameOriginFrame(pathname: string): boolean {
  // /api/knowledge/<id>/file  — streams the original uploaded PDF/image that the
  // Knowledge panel renders inline in an <iframe>/<img>.
  return /^\/api\/knowledge\/[^/]+\/file\/?$/.test(pathname);
}

// Mutate a Headers object in place. Used by middleware on each response.
export function applySecurityHeaders(
  target: Headers,
  opts: { allowSameOriginFrame?: boolean } = {}
): void {
  for (const [k, v] of Object.entries(securityHeaders(opts))) target.set(k, v);
}
