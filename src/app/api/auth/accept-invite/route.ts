import { NextRequest, NextResponse } from "next/server";
import {
  getInvitationByToken,
  acceptInvitation,
  createSession,
  setSessionCookieValue,
} from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/security/enforce";
import { RATE_RULES } from "@/lib/security/rateLimit";
import { safeHandler } from "@/lib/api/safeHandler";
import { canAddUser } from "@/lib/billing/limits";

export const runtime = "nodejs";

// GET /api/auth/accept-invite?token=... — preview an invite (email + org) so the
// accept page can show who/what the user is joining. Never leaks the org id.
export const GET = safeHandler("auth.accept-invite.get", async (req: NextRequest) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const invite = await getInvitationByToken(token);
  if (!invite) {
    return NextResponse.json({ error: "invalid", message: "This invitation is invalid or has expired." }, { status: 404 });
  }
  return NextResponse.json({ email: invite.email, role: invite.role });
});

// POST /api/auth/accept-invite — set a name + password, create the account in
// the issuing org, and sign in. The org is taken from the invite, not the body.
export const POST = safeHandler("auth.accept-invite.post", async (req: NextRequest) => {
  const limited = enforceRateLimit(req, "auth:accept-invite", RATE_RULES.auth());
  if (limited) return limited;

  const { token, name, password } = await req.json().catch(() => ({}));
  if (!token || !password || password.length < 8) {
    return NextResponse.json(
      { error: "bad_request", message: "A valid token and a password (8+ chars) are required." },
      { status: 400 }
    );
  }
  // Seat limit edge case: the org may have filled up between issuing and
  // accepting the invite. Block creating the account past the plan cap. (A
  // pending invite already counts toward the cap, so a same-invite acceptance is
  // fine; this catches the over-capacity case.)
  const invite = await getInvitationByToken(token);
  if (invite) {
    const seats = await canAddUser(invite.orgId);
    // The pending invite is included in `used`; allow up to limit + this invite.
    if (!seats.allowed && seats.limit != null && seats.activeUsers >= seats.limit) {
      return NextResponse.json(
        { error: "user_limit_reached", message: "This organization has reached its plan's user limit. Ask an admin to upgrade the plan or free a seat, then try again." },
        { status: 402 }
      );
    }
  }
  const user = await acceptInvitation(token, name, await hashPassword(password));
  if (!user) {
    return NextResponse.json({ error: "invalid", message: "This invitation is invalid or has expired." }, { status: 404 });
  }
  const sessionToken = await createSession(user.id, user.orgId);
  await setSessionCookieValue(sessionToken);
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
