import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import {
  createInvitation,
  revokeInvitation,
  findUserByEmail,
} from "@/lib/auth/session";
import { isValidRole, type Role } from "@/lib/auth/roles";
import { audit } from "@/lib/events";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// POST /api/org/invitations — invite a teammate by email with a role. The
// invite is bound to the caller's org; accepting it can only ever create a user
// inside THIS tenant. Owners/admins only.
export const POST = safeHandler("org.invitations.post", async (req: NextRequest) => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const { email, role } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json(
      { error: "bad_request", message: "A valid email address is required." },
      { status: 400 }
    );
  }
  const wantRole: Role = isValidRole(role) ? role : "technician";
  // Never invite someone to be an owner; ownership is transferred explicitly.
  if (wantRole === "owner") {
    return NextResponse.json(
      { error: "bad_request", message: "Owners cannot be created by invitation." },
      { status: 400 }
    );
  }
  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { error: "email_taken", message: "That email already has an account." },
      { status: 409 }
    );
  }
  const invite = await createInvitation(gate.user.orgId, email, wantRole, gate.user.id);
  await audit(gate.user.orgId, gate.user.email, "invite.create", invite.id, { email, role: wantRole });

  // The accept link the customer shares with their teammate. In production an
  // email is sent; we also return it so the inviter can copy it directly.
  const origin = req.nextUrl.origin;
  const acceptUrl = `${origin}/accept-invite?token=${invite.token}`;
  return NextResponse.json({
    invitation: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt.getTime() },
    acceptUrl,
  });
});

// DELETE /api/org/invitations?id=... — revoke a pending invite. Owners/admins.
export const DELETE = safeHandler("org.invitations.delete", async (req: NextRequest) => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const inviteId = req.nextUrl.searchParams.get("id");
  if (!inviteId) {
    return NextResponse.json({ error: "bad_request", message: "id is required." }, { status: 400 });
  }
  await revokeInvitation(gate.user.orgId, inviteId);
  await audit(gate.user.orgId, gate.user.email, "invite.revoke", inviteId, null);
  return NextResponse.json({ ok: true });
});
