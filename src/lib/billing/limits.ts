import { db, ensureDb } from "@/lib/db";
import { users, documents, assetPhotos, invitations } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSubscription } from "./subscription";
import { planUserLimit, planStorageBytes, getPlan } from "./plans";

// Plan quota enforcement (users + storage), strictly org-scoped. These NEVER
// delete or hide data — they only gate NEW users/uploads when a plan cap is hit.

async function planKeyFor(orgId: string): Promise<string> {
  const sub = await getSubscription(orgId);
  return sub?.plan ?? "free_trial";
}

// ── Users ───────────────────────────────────────────────────────────────
export async function orgUserCount(orgId: string): Promise<number> {
  await ensureDb();
  const r = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.orgId, orgId));
  return Number(r[0]?.n ?? 0);
}

export async function orgPendingInviteCount(orgId: string): Promise<number> {
  await ensureDb();
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), eq(invitations.status, "pending")));
  return Number(r[0]?.n ?? 0);
}

export interface UserLimitDecision {
  allowed: boolean;
  used: number; // active users + pending invites
  activeUsers: number;
  pendingInvites: number;
  limit: number | null; // null = unlimited
  plan: string;
  reason: string | null;
}

// Can this org add ONE more user (invite or create)? Counts active members plus
// pending invites so an admin can't over-invite past the plan cap.
export async function canAddUser(orgId: string): Promise<UserLimitDecision> {
  const planKey = await planKeyFor(orgId);
  const limit = planUserLimit(planKey);
  const activeUsers = await orgUserCount(orgId);
  const pendingInvites = await orgPendingInviteCount(orgId);
  const used = activeUsers + pendingInvites;
  const plan = getPlan(planKey);
  if (limit != null && used >= limit) {
    return {
      allowed: false,
      used, activeUsers, pendingInvites, limit, plan: plan.name,
      reason: `Your ${plan.name} plan includes ${limit} users and all seats are in use (${activeUsers} active${pendingInvites ? ` + ${pendingInvites} pending invite${pendingInvites === 1 ? "" : "s"}` : ""}). Upgrade the plan or remove a member to add another.`,
    };
  }
  return { allowed: true, used, activeUsers, pendingInvites, limit, plan: plan.name, reason: null };
}

// ── Storage ─────────────────────────────────────────────────────────────
export async function orgStorageBytes(orgId: string): Promise<number> {
  await ensureDb();
  const d = await db
    .select({ n: sql<number>`coalesce(sum(${documents.sizeBytes}), 0)` })
    .from(documents)
    .where(eq(documents.orgId, orgId));
  const p = await db
    .select({ n: sql<number>`coalesce(sum(${assetPhotos.sizeBytes}), 0)` })
    .from(assetPhotos)
    .where(eq(assetPhotos.orgId, orgId));
  return Number(d[0]?.n ?? 0) + Number(p[0]?.n ?? 0);
}

export interface StorageStatus {
  usedBytes: number;
  limitBytes: number | null; // null = unlimited
  pct: number; // 0..100+ (0 when unlimited)
  warn: boolean; // >= 80%
  over: boolean; // >= 100%
  plan: string;
}

export async function storageStatus(orgId: string): Promise<StorageStatus> {
  const planKey = await planKeyFor(orgId);
  const limitBytes = planStorageBytes(planKey);
  const usedBytes = await orgStorageBytes(orgId);
  const plan = getPlan(planKey).name;
  if (limitBytes == null) return { usedBytes, limitBytes, pct: 0, warn: false, over: false, plan };
  const pct = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0;
  return { usedBytes, limitBytes, pct, warn: pct >= 80, over: pct >= 100, plan };
}

export interface UploadDecision {
  allowed: boolean;
  reason: string | null;
  status: StorageStatus;
}

// Can this org upload `incomingBytes` more? Blocks only when it would exceed the
// plan cap. Existing files are never touched.
export async function canUpload(orgId: string, incomingBytes: number): Promise<UploadDecision> {
  const status = await storageStatus(orgId);
  if (status.limitBytes == null) return { allowed: true, reason: null, status };
  if (status.usedBytes + incomingBytes > status.limitBytes) {
    const gb = (status.limitBytes / 1e9).toFixed(0);
    return {
      allowed: false,
      reason: `This upload would exceed your ${status.plan} plan storage limit (${gb} GB). Existing files are safe — remove some files or upgrade the plan to add more.`,
      status,
    };
  }
  return { allowed: true, reason: null, status };
}
