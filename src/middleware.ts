import { NextRequest, NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security/headers";

// Kept in sync with SESSION_COOKIE in src/lib/auth/session.ts. Inlined here so
// middleware doesn't import the DB layer (edge runtime).
const SESSION_COOKIE = "eas_session";

// Middleware does two things on EVERY request:
//   1. Stamps the OWASP security headers on the response (applies to pages, API,
//      and static alike — one uniform security posture).
//   2. When AUTH_REQUIRED=true, gates app pages on a session cookie's presence.
//      Real session validation (DB lookup) happens in route handlers / pages on
//      the Node runtime — middleware only checks presence so it stays edge-safe.
//
// Public always-allowed: /login, /api/auth/*, the public API /api/v1/* (API-key
// auth), the health probe, and Next internals/static assets.

// Finalize a response with the shared security headers.
function harden(res: NextResponse): NextResponse {
  applySecurityHeaders(res.headers);
  return res;
}

// Mirrors demoModeEnabled() in lib/util.ts. Inlined so middleware stays edge-safe
// and never imports the (crypto/DB-bound) util or auth layers.
function demoModeEnabled(): boolean {
  return (
    process.env.DEMO_MODE === "true" ||
    process.env.OPEN_MODE_ORG === "demo" ||
    process.env.SEED_DEMO_ORG === "true"
  );
}

// Mirrors authRequired() in lib/auth/session.ts (kept inline for the edge
// runtime). MANDATORY LOGIN BY DEFAULT: the real Production Workspace requires
// authentication unless it is the isolated demo, or an operator explicitly opts
// out for a single-user local run.
function authGateActive(): boolean {
  if (process.env.AUTH_REQUIRED === "true") return true;
  if (process.env.AUTH_REQUIRED === "false") return false;
  if (demoModeEnabled()) return false;
  if (process.env.ALLOW_INSECURE_OPEN_PRODUCTION === "true") return false;
  return true;
}

export function middleware(req: NextRequest) {
  if (!authGateActive()) return harden(NextResponse.next());

  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    // A newly invited user must reach the invite-acceptance page (to set their
    // password) BEFORE they have a session — gating it would trap them at /login.
    pathname.startsWith("/accept-invite") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/v1") ||
    pathname === "/api/health";
  if (isPublic) return harden(NextResponse.next());

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return harden(NextResponse.next());

  // Redirect page navigations to /login; reject API calls with 401.
  if (pathname.startsWith("/api/")) {
    return harden(
      NextResponse.json({ error: "unauthenticated" }, { status: 401 })
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return harden(NextResponse.redirect(url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
