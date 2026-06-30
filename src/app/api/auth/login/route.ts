import { NextRequest, NextResponse } from "next/server";
import {
  findUserByEmail,
  createSession,
  setSessionCookieValue,
} from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/security/enforce";
import { RATE_RULES } from "@/lib/security/rateLimit";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const POST = safeHandler("auth.login", async (req: NextRequest) => {
  // Brute-force protection: cap login attempts per client IP.
  const limited = enforceRateLimit(req, "auth:login", RATE_RULES.auth());
  if (limited) return limited;

  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }
  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }
  // Session is scoped to the user's organization.
  const token = await createSession(user.id, user.orgId);
  await setSessionCookieValue(token);
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
