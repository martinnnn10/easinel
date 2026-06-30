import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  destroySession,
  clearSessionCookie,
  revokeUserSessions,
  getCurrentUser,
  SESSION_COOKIE,
} from "@/lib/auth/session";

export const runtime = "nodejs";

// POST /api/auth/logout            → sign out this device.
// POST /api/auth/logout {all:true} → sign out everywhere (revoke all sessions).
export async function POST(req: NextRequest) {
  const { all } = await req.json().catch(() => ({}));
  if (all) {
    const user = await getCurrentUser();
    if (user && user.id !== "open-mode") {
      await revokeUserSessions(user.orgId, user.id);
    }
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
