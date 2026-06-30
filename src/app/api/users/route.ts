import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/guard";
import { createUser, setMemberRole, listMembers, countOwners } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { isValidRole } from "@/lib/auth/roles";
import { audit } from "@/lib/events";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("users.get", async () => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  await ensureDb();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      ssoProvider: users.ssoProvider,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.orgId, gate.user.orgId))
    .orderBy(desc(users.createdAt));
  return NextResponse.json({ users: rows });
});

export const POST = safeHandler("users.post", async (req: NextRequest) => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body.email || !isValidRole(body.role)) {
    return NextResponse.json({ error: "email and valid role required" }, { status: 400 });
  }
  const user = await createUser({
    orgId: gate.user.orgId,
    email: body.email,
    name: body.name || body.email.split("@")[0],
    role: body.role,
    passwordHash: body.password ? await hashPassword(body.password) : null,
  });
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// Role change goes through the hardened path: tenant-scoped, last-owner
// protected, and it REVOKES the member's sessions so a demotion takes effect
// immediately rather than at cookie expiry.
export const PATCH = safeHandler("users.patch", async (req: NextRequest) => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body.id || !isValidRole(body.role)) {
    return NextResponse.json({ error: "id and valid role required" }, { status: 400 });
  }
  const members = await listMembers(gate.user.orgId);
  const target = members.find((m) => m.id === body.id);
  if (!target) {
    return NextResponse.json({ error: "not_found", message: "No such member in this organization." }, { status: 404 });
  }
  if (target.role === "owner" && body.role !== "owner" && (await countOwners(gate.user.orgId)) <= 1) {
    return NextResponse.json(
      { error: "last_owner", message: "You can't demote the only owner." },
      { status: 409 }
    );
  }
  await setMemberRole(gate.user.orgId, body.id, body.role);
  await audit(gate.user.orgId, gate.user.email, "member.role_change", body.id, { role: body.role });
  return NextResponse.json({ ok: true });
});
