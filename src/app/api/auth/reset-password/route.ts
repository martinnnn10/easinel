import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/security/enforce";
import { RATE_RULES } from "@/lib/security/rateLimit";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/auth/reset-password
// Validates a reset token and sets a new password.
export const POST = safeHandler("auth.reset-password", async (req: NextRequest) => {
  const limited = enforceRateLimit(req, "auth:reset-password", RATE_RULES.auth());
  if (limited) return limited;

  const { token, password } = await req.json().catch(() => ({}));
  if (!token || !password || password.length < 8) {
    return NextResponse.json(
      { error: "bad_request", message: "Token and a password (8+ chars) are required." },
      { status: 400 }
    );
  }

  // Find user with this valid, non-expired token.
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.resetToken, token),
        gt(schema.users.resetTokenExpires, new Date(Date.now()))
      )
    );

  const user = rows[0];
  if (!user) {
    return NextResponse.json(
      { error: "invalid_token", message: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  // Update password and clear the reset token.
  const passwordHash = await hashPassword(password);
  await db
    .update(schema.users)
    .set({
      passwordHash,
      resetToken: null,
      resetTokenExpires: null,
      emailVerified: true, // resetting password proves email ownership
    })
    .where(eq(schema.users.id, user.id));

  return NextResponse.json({ ok: true });
});
