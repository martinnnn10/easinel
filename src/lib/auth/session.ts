import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { db, ensureDb } from "@/lib/db";
import { users, sessions, orgs, invitations, type User } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { id, DEMO_ORG, GLOBAL_ORG, isReservedOrg, openModeOrgId, demoModeEnabled } from "@/lib/util";
import type { Role } from "./roles";

const INVITE_DAYS = 14;

export const SESSION_COOKIE = "eas_session";
const SESSION_DAYS = 30;

export function authRequired(): boolean {
  // Explicit override always wins, in either direction.
  if (process.env.AUTH_REQUIRED === "true") return true;
  if (process.env.AUTH_REQUIRED === "false") return false;
  // The isolated DEMO workspace is the ONLY open-by-default path — it holds no
  // real customer data, so public sales demos run with zero login friction.
  if (demoModeEnabled()) return false;
  // MANDATORY LOGIN BY DEFAULT for the real Production Workspace: every real user
  // must authenticate and belong to an organization. A single-user LOCAL run can
  // deliberately opt out with ALLOW_INSECURE_OPEN_PRODUCTION=true (flagged as
  // insecure by the health probe). This makes "a protected page reachable without
  // auth on real customer data" impossible unless someone explicitly turns it off.
  if (process.env.ALLOW_INSECURE_OPEN_PRODUCTION === "true") return false;
  return true;
}

// Synthetic owner used in open mode (AUTH_REQUIRED not set), so the product runs
// with zero auth friction while all RBAC checks still resolve correctly.
export function openModeUser(): User {
  return {
    id: "open-mode",
    orgId: openModeOrgId(),
    email: "owner@local",
    name: "Owner",
    role: "owner",
    passwordHash: null,
    ssoProvider: null,
    externalId: null,
    lastLoginAt: null,
    createdAt: new Date(),
  } as User;
}

export async function countUsers(orgId: string): Promise<number> {
  if (!orgId) throw new Error("countUsers() requires orgId");
  await ensureDb();
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId));
  return rows.length;
}

// Count REAL (customer) users across all tenants, excluding the reserved Demo
// and Global system orgs. Used to decide whether the self-serve owner-bootstrap
// endpoint is still open. The Demo Org's seeded owner must never block a real
// first registration.
export async function countAllRealUsers(): Promise<number> {
  await ensureDb();
  const rows = await db.select({ id: users.id, orgId: users.orgId }).from(users);
  return rows.filter((r) => r.orgId !== DEMO_ORG && r.orgId !== GLOBAL_ORG).length;
}

// Create an organization (workspace). Returns its id.
export async function createOrg(name: string): Promise<string> {
  await ensureDb();
  const orgId = id("org");
  // Defense in depth: a customer workspace can never collide with a reserved
  // system tenant (Demo/Global/unset). id() is a random UUID so this is a guard
  // against future changes, not an expected condition.
  if (isReservedOrg(orgId)) throw new Error("createOrg() produced a reserved org id");
  await db.insert(orgs).values({ id: orgId, name: name.trim().slice(0, 80) || "My Organization" });
  return orgId;
}

export async function getOrg(orgId: string): Promise<{ id: string; name: string } | null> {
  await ensureDb();
  const rows = await db.select().from(orgs).where(eq(orgs.id, orgId));
  return rows[0] ? { id: rows[0].id, name: rows[0].name } : null;
}

export async function createSession(userId: string, orgId: string): Promise<string> {
  if (!orgId) throw new Error("createSession() requires orgId");
  await ensureDb();
  const token = "sess_" + randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id: token, orgId, userId, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await ensureDb();
  await db.delete(sessions).where(eq(sessions.id, token));
}

// Revoke EVERY active session for a user. Called on role change, removal, or a
// user-initiated "sign out everywhere". This is a hard security requirement: a
// demoted or removed account must lose access immediately, not after its 30-day
// cookie expires.
export async function revokeUserSessions(orgId: string, userId: string): Promise<void> {
  if (!orgId) throw new Error("revokeUserSessions() requires orgId");
  await ensureDb();
  await db
    .delete(sessions)
    .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, userId)));
}

// Resolve the current user from the session cookie (DB-backed).
export async function getSessionUser(): Promise<User | null> {
  await ensureDb();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));
  const sess = rows[0];
  if (!sess) return null;
  const u = await db.select().from(users).where(eq(users.id, sess.userId));
  return u[0] ?? null;
}

// The single entry point routes use. Open mode → synthetic owner.
export async function getCurrentUser(): Promise<User | null> {
  if (!authRequired()) return openModeUser();
  return getSessionUser();
}

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  orgId?: string;
  passwordHash?: string | null;
  ssoProvider?: string | null;
  externalId?: string | null;
}): Promise<User> {
  await ensureDb();
  const uid = id("usr");
  await db.insert(users).values({
    id: uid,
    orgId: input.orgId ?? DEMO_ORG,
    email: input.email.toLowerCase(),
    name: input.name,
    role: input.role,
    passwordHash: input.passwordHash ?? null,
    ssoProvider: input.ssoProvider ?? null,
    externalId: input.externalId ?? null,
  });
  return (await db.select().from(users).where(eq(users.id, uid)))[0];
}

// Look up a user by email across ALL organizations — login resolves which org
// the user belongs to, so a person signs into their own workspace.
export async function findUserByEmail(email: string): Promise<User | undefined> {
  await ensureDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return rows[0];
}

// Look up a user by email WITHIN a single org. Used by tenant-bound flows like
// invitation acceptance, where a same-email account in a DIFFERENT tenant must
// never be reused — that would be a cross-tenant identity leak.
export async function findUserByEmailInOrg(
  orgId: string,
  email: string
): Promise<User | undefined> {
  if (!orgId) throw new Error("findUserByEmailInOrg() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.email, email.toLowerCase())));
  return rows[0];
}

// ───────────────────────── Organization management ─────────────────────────

export async function renameOrg(orgId: string, name: string): Promise<void> {
  if (!orgId) throw new Error("renameOrg() requires orgId");
  await ensureDb();
  await db.update(orgs).set({ name: name.trim().slice(0, 80) || "My Organization" }).where(eq(orgs.id, orgId));
}

// List the members of ONE organization. Strictly org-scoped.
export async function listMembers(orgId: string): Promise<User[]> {
  if (!orgId) throw new Error("listMembers() requires orgId");
  await ensureDb();
  return db.select().from(users).where(eq(users.orgId, orgId));
}

// Change a member's role. Tenant-bound (the target MUST be in the caller's org)
// and revokes the member's sessions so the new permissions take effect at once.
export async function setMemberRole(orgId: string, userId: string, role: Role): Promise<User | undefined> {
  if (!orgId) throw new Error("setMemberRole() requires orgId");
  await ensureDb();
  await db.update(users).set({ role }).where(and(eq(users.orgId, orgId), eq(users.id, userId)));
  await revokeUserSessions(orgId, userId);
  const rows = await db.select().from(users).where(and(eq(users.orgId, orgId), eq(users.id, userId)));
  return rows[0];
}

// Remove a member from an org and kill their sessions. Tenant-bound.
export async function removeMember(orgId: string, userId: string): Promise<void> {
  if (!orgId) throw new Error("removeMember() requires orgId");
  await ensureDb();
  await db.delete(users).where(and(eq(users.orgId, orgId), eq(users.id, userId)));
  await revokeUserSessions(orgId, userId);
}

export async function countOwners(orgId: string): Promise<number> {
  await ensureDb();
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.orgId, orgId), eq(users.role, "owner")));
  return rows.length;
}

// ───────────────────────── Invitations ─────────────────────────

export interface InviteRecord {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function createInvitation(
  orgId: string,
  email: string,
  role: Role,
  invitedBy: string
): Promise<InviteRecord> {
  if (!orgId) throw new Error("createInvitation() requires orgId");
  await ensureDb();
  const token = "inv_" + randomBytes(24).toString("base64url");
  const inviteId = id("inv");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);
  await db.insert(invitations).values({
    id: inviteId,
    orgId,
    email: email.toLowerCase(),
    role,
    token,
    invitedBy,
    status: "pending",
    expiresAt,
  });
  return { id: inviteId, email: email.toLowerCase(), role, status: "pending", token, expiresAt, createdAt: new Date() };
}

export async function listInvitations(orgId: string): Promise<InviteRecord[]> {
  if (!orgId) throw new Error("listInvitations() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), eq(invitations.status, "pending")));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    token: r.token,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

export async function revokeInvitation(orgId: string, inviteId: string): Promise<void> {
  if (!orgId) throw new Error("revokeInvitation() requires orgId");
  await ensureDb();
  await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.orgId, orgId), eq(invitations.id, inviteId)));
}

// Resolve a pending, non-expired invite by its token (used on the accept page).
export async function getInvitationByToken(token: string) {
  await ensureDb();
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.token, token), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date())));
  return rows[0];
}

// Accept an invite: creates the user INSIDE the issuing org (never anywhere
// else), marks the invite accepted, and returns the new user. The org is taken
// from the invite row itself — the accepting client cannot influence it.
export async function acceptInvitation(
  token: string,
  name: string,
  passwordHash: string
): Promise<User | null> {
  await ensureDb();
  const invite = await getInvitationByToken(token);
  if (!invite) return null;
  // Existing-account check is scoped to the ISSUING org only. A same-email user
  // in another tenant is irrelevant here and must never be reused (cross-tenant
  // identity leak). Within the issuing org, re-accepting just closes the invite.
  const existing = await findUserByEmailInOrg(invite.orgId, invite.email);
  if (existing) {
    await db.update(invitations).set({ status: "accepted", acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
    return existing;
  }
  const user = await createUser({
    orgId: invite.orgId, // bound to the issuing tenant — not client-controlled
    email: invite.email,
    name: name || invite.email.split("@")[0],
    role: invite.role as Role,
    passwordHash,
  });
  await db.update(invitations).set({ status: "accepted", acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
  return user;
}

export async function setSessionCookieValue(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
