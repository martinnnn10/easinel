import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, fetchUserInfo, oidcDefaultRole } from "@/lib/auth/oidc";
import {
  findUserByEmail,
  createUser,
  createSession,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("auth.oidc.callback", async (req: NextRequest) => {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("eas_oidc_state")?.value;

  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/login?error=sso_state", url.origin));
  }

  try {
    const tokens = await exchangeCode(code, url.origin);
    const info = await fetchUserInfo(tokens.access_token);

    let user = await findUserByEmail(info.email);
    if (!user) {
      user = await createUser({
        email: info.email,
        name: info.name,
        role: oidcDefaultRole(),
        ssoProvider: "oidc",
        externalId: info.sub,
      });
    }
    const token = await createSession(user.id, user.orgId);
    const res = NextResponse.redirect(new URL("/today", url.origin));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 86400,
    });
    res.cookies.delete("eas_oidc_state");
    return res;
  } catch (err) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent((err as Error).message)}`, url.origin)
    );
  }
});
