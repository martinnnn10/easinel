import { NextRequest, NextResponse } from "next/server";
import {
  createOrg,
  createUser,
  createSession,
  setSessionCookieValue,
  findUserByEmail,
} from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/security/enforce";
import { RATE_RULES } from "@/lib/security/rateLimit";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Create an ORGANIZATION + its owner account, and sign in. This is how a new
// company onboards: one call creates the workspace and the first admin.
export const POST = safeHandler("auth.signup", async (req: NextRequest) => {
  // Throttle signups per IP — stops automated org-spam / resource exhaustion.
  const limited = enforceRateLimit(req, "auth:signup", RATE_RULES.auth());
  if (limited) return limited;

  const { orgName, name, email, password } = await req.json().catch(() => ({}));
  if (!orgName || !email || !password || password.length < 8) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: "Organization name, email, and a password (8+ chars) are required.",
      },
      { status: 400 }
    );
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { error: "email_taken", message: "That email already has an account. Sign in instead." },
      { status: 409 }
    );
  }

  const orgId = await createOrg(orgName);
  const user = await createUser({
    orgId,
    email,
    name: name || email.split("@")[0],
    role: "owner",
    passwordHash: await hashPassword(password),
  });
  const token = await createSession(user.id, orgId);
  await setSessionCookieValue(token);
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    org: { id: orgId, name: orgName },
  });
});
