import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/auth/resend-verification
// Generates a new verification token for the current logged-in user.
// In pilot mode, logs the verification URL to the server console.
export const POST = safeHandler("auth.resend-verification", async () => {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (user.emailVerified) {
    return NextResponse.json({ ok: true, message: "Already verified." });
  }

  const token = randomBytes(32).toString("hex");
  await db
    .update(schema.users)
    .set({ verificationToken: token })
    .where(eq(schema.users.id, user.id));

  const baseUrl = process.env.APP_BASE_URL || "https://easmaint.com";
  const verifyUrl = `${baseUrl}/verify?token=${token}`;
  console.log(`[PILOT] Verification resent for ${user.email}`);
  console.log(`[PILOT] Verify URL: ${verifyUrl}`);

  return NextResponse.json({ ok: true });
});
