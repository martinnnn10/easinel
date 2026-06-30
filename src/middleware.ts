import { NextRequest, NextResponse } from "next/server";

// Kept in sync with SESSION_COOKIE in src/lib/auth/session.ts. Inlined here so
// middleware doesn't import the DB layer (edge runtime).
const SESSION_COOKIE = "eas_session";

// Lightweight gate: when AUTH_REQUIRED=true, app pages need a session cookie.
// Actual session validation (DB lookup) happens in route handlers / pages on the
// Node runtime — middleware only checks presence so it stays edge-safe.
//
// Public always-allowed: /login, /api/auth/*, the public API /api/v1/* (API-key
// auth), and Next internals/static assets.

export function middleware(req: NextRequest) {
  if (process.env.AUTH_REQUIRED !== "true") return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/v1");
  if (isPublic) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  // Redirect page navigations to /login; reject API calls with 401.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
