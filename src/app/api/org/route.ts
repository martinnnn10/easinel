import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getOrg,
  renameOrg,
  listMembers,
  listInvitations,
} from "@/lib/auth/session";
import { audit } from "@/lib/events";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// GET /api/org — the organization profile, its members, and pending invites.
// Any authenticated member may read it; mutation requires manage_users.
export const GET = safeHandler("org.get", async () => {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const org = await getOrg(user.orgId);
  const members = await listMembers(user.orgId);
  // Pending invites are admin-only detail; hide them from non-managers.
  const canManage = user.role === "owner" || user.role === "admin";
  const invites = canManage ? await listInvitations(user.orgId) : [];
  return NextResponse.json({
    org: org ?? { id: user.orgId, name: "My Organization" },
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      ssoProvider: m.ssoProvider,
      lastLoginAt: m.lastLoginAt ? m.lastLoginAt.getTime() : null,
    })),
    invitations: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.getTime(),
    })),
    you: { id: user.id, role: user.role },
  });
});

// PATCH /api/org — rename the organization. Owners/admins only.
export const PATCH = safeHandler("org.patch", async (req: NextRequest) => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const { name } = await req.json().catch(() => ({}));
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "bad_request", message: "A non-empty organization name is required." },
      { status: 400 }
    );
  }
  await renameOrg(gate.user.orgId, name);
  await audit(gate.user.orgId, gate.user.email, "org.rename", gate.user.orgId, name.trim());
  const org = await getOrg(gate.user.orgId);
  return NextResponse.json({ org });
});
