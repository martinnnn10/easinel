import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import {
  setMemberRole,
  removeMember,
  listMembers,
  countOwners,
} from "@/lib/auth/session";
import { isValidRole, type Role } from "@/lib/auth/roles";
import { audit } from "@/lib/events";

export const runtime = "nodejs";

// PATCH /api/org/members/:id — change a member's role. Owners/admins only.
// Guards against removing the last owner (which would orphan the org).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const { role } = await req.json().catch(() => ({}));
  if (!isValidRole(role)) {
    return NextResponse.json({ error: "bad_request", message: "A valid role is required." }, { status: 400 });
  }

  // The target must belong to the caller's org (listMembers is org-scoped).
  const members = await listMembers(gate.user.orgId);
  const target = members.find((m) => m.id === id);
  if (!target) {
    return NextResponse.json({ error: "not_found", message: "No such member in this organization." }, { status: 404 });
  }
  // Don't allow demoting the last owner.
  if (target.role === "owner" && role !== "owner" && (await countOwners(gate.user.orgId)) <= 1) {
    return NextResponse.json(
      { error: "last_owner", message: "You can't demote the only owner. Promote someone else first." },
      { status: 409 }
    );
  }
  const updated = await setMemberRole(gate.user.orgId, id, role as Role);
  await audit(gate.user.orgId, gate.user.email, "member.role_change", id, { role });
  return NextResponse.json({
    member: updated ? { id: updated.id, name: updated.name, email: updated.email, role: updated.role } : null,
  });
}

// DELETE /api/org/members/:id — remove a member. Owners/admins only.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  if (id === gate.user.id) {
    return NextResponse.json({ error: "bad_request", message: "You can't remove yourself." }, { status: 400 });
  }
  const members = await listMembers(gate.user.orgId);
  const target = members.find((m) => m.id === id);
  if (!target) {
    return NextResponse.json({ error: "not_found", message: "No such member in this organization." }, { status: 404 });
  }
  if (target.role === "owner" && (await countOwners(gate.user.orgId)) <= 1) {
    return NextResponse.json(
      { error: "last_owner", message: "You can't remove the only owner." },
      { status: 409 }
    );
  }
  await removeMember(gate.user.orgId, id);
  await audit(gate.user.orgId, gate.user.email, "member.remove", id, { email: target.email });
  return NextResponse.json({ ok: true });
}
