import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/auth/verify-email
// Validates a verification token and marks the user's email as verified.
export const POST = safeHandler("auth.verify-email", async (req: NextRequest) => {
  const { token } = await req.json().catch(() => ({}));
  if (!token) {
    return NextResponse.json(
      { error: "bad_request", message: "Verification token is required." },
      { status: 400 }
    );
  }

  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.verificationToken, token));

  const user = rows[0];
  if (!user) {
    return NextResponse.json(
      { error: "invalid_token", message: "This verification link is invalid." },
      { status: 400 }
    );
  }

  await db
    .update(schema.users)
    .set({ emailVerified: true, verificationToken: null })
    .where(eq(schema.users.id, user.id));

  return NextResponse.json({ ok: true, email: user.email });
});
