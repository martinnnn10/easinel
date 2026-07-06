import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { enforceRateLimit } from "@/lib/security/enforce";
import { RATE_RULES } from "@/lib/security/rateLimit";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/auth/forgot-password
// Generates a password reset token. In pilot mode, logs the reset URL to the
// server console (no email service configured yet). Always returns 200 to
// prevent email enumeration.
export const POST = safeHandler("auth.forgot-password", async (req: NextRequest) => {
  const limited = enforceRateLimit(req, "auth:forgot-password", RATE_RULES.auth());
  if (limited) return limited;

  const { email } = await req.json().catch(() => ({}));
  if (!email) {
    return NextResponse.json({ ok: true }); // don't reveal missing email
  }

  const user = await findUserByEmail(email);
  if (!user) {
    // Don't reveal whether the email exists.
    return NextResponse.json({ ok: true });
  }

  // Generate a secure reset token with 1-hour expiry.
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 60 * 60 * 1000; // 1 hour

  await db
    .update(schema.users)
    .set({ resetToken: token, resetTokenExpires: new Date(expires) })
    .where(eq(schema.users.id, user.id));

  // In pilot mode: log the reset URL to the server console.
  const baseUrl = process.env.APP_BASE_URL || "https://easmaint.com";
  const resetUrl = `${baseUrl}/login/reset?token=${token}`;
  console.log(`[PILOT] Password reset requested for ${email}`);
  console.log(`[PILOT] Reset URL: ${resetUrl}`);

  return NextResponse.json({ ok: true });
});
