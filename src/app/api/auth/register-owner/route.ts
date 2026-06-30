import { NextRequest, NextResponse } from "next/server";
import {
  countAllRealUsers,
  createOrg,
  createUser,
  createSession,
  setSessionCookieValue,
} from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

// Bootstrap the first customer account (owner). Creates a brand-new EMPTY
// organization (tenant) for the owner — never the Demo Org. Only works while no
// real customer users exist yet; it closes itself after the platform is
// initialized so it cannot be used to mint additional orgs without auth.
export async function POST(req: NextRequest) {
  const { email, name, password, orgName } = await req.json().catch(() => ({}));
  if ((await countAllRealUsers()) > 0) {
    return NextResponse.json(
      { error: "already_initialized", message: "An owner already exists. Sign in instead." },
      { status: 409 }
    );
  }
  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "bad_request", message: "Email and a password (8+ chars) are required." },
      { status: 400 }
    );
  }
  // New, isolated tenant for this customer. Starts completely empty.
  const orgId = await createOrg(orgName || `${(name || email.split("@")[0])}'s Organization`);
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
    org: { id: orgId },
  });
}
