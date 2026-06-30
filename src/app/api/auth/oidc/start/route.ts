import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { oidcConfigured, buildAuthUrl } from "@/lib/auth/oidc";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("auth.oidc.start", async (req: NextRequest) => {
  if (!oidcConfigured()) {
    return NextResponse.json({ error: "SSO not configured" }, { status: 400 });
  }
  const state = randomBytes(16).toString("hex");
  const origin = req.nextUrl.origin;
  const url = await buildAuthUrl(state, origin);
  const res = NextResponse.redirect(url);
  res.cookies.set("eas_oidc_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
});
