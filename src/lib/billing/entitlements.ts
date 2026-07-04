import { getSubscription, hasActiveAccess } from "./subscription";
import { canUseLive } from "@/lib/ai/usage";
import { canAddUser, storageStatus, canUpload } from "./limits";

// ─────────────────────────────────────────────────────────────────────────
// CENTRAL ENTITLEMENT LAYER
//
// One server-side source of truth for "what may this org do right now?", so
// future gating never scatters across routes. Payment failure NEVER blocks
// safety-critical, manual maintenance work — only live AI, AI generation, new
// uploads, and new user invites degrade.
//
// Grace model (past_due / canceled / expired trial, when Stripe is configured):
//   READABLE + MANUAL stay ON  → history, manual work orders, manual handover,
//                                 manual closeout, manual scenario/PM edits.
//   AI + growth turn OFF        → live AI, AI-generated PMs/scenarios, uploads,
//                                 inviting users.
// When Stripe is NOT configured, hasActiveAccess() fail-opens, so nothing here
// blocks a self-hosted/no-billing deployment.
// ─────────────────────────────────────────────────────────────────────────

export interface AiEntitlement {
  allowed: boolean;
  reason: string | null;
}

// Lean AI check (used on the chat hot path and by AI-generation routes). Live AI
// / AI generation require an ACTIVE subscription AND pass the AI quota + kill
// switch (canUseLive). Expired trial / past_due / canceled → blocked.
export async function aiEntitlement(orgId: string): Promise<AiEntitlement> {
  const billingActive = await hasActiveAccess(orgId);
  if (!billingActive) {
    return {
      allowed: false,
      reason: "Live AI and AI generation are paused while billing is inactive. Your maintenance data stays fully accessible — update billing to re-enable AI.",
    };
  }
  const ai = await canUseLive(orgId); // kill switch, per-org monthly AI quota, past_due/canceled
  return { allowed: ai.allowed, reason: ai.reason };
}

export interface Entitlements {
  billingActive: boolean;
  subscriptionStatus: string | null;
  // AI + growth (degrade on payment failure / quota)
  canUseLiveAI: boolean;
  canGeneratePMsWithAI: boolean;
  canGenerateScenariosWithAI: boolean;
  canUploadFiles: boolean;
  canInviteUsers: boolean;
  // Safety-critical / manual (ALWAYS available, even during grace)
  canCreateManualWorkOrders: boolean;
  canCreateManualHandoverNotes: boolean;
  canViewExistingMaintenanceHistory: boolean;
  reasons: Record<string, string>;
}

// Full entitlement snapshot for an org — the single helper routes/UI consult.
export async function getEntitlements(orgId: string): Promise<Entitlements> {
  const sub = await getSubscription(orgId);
  const billingActive = await hasActiveAccess(orgId);
  const ai = await aiEntitlement(orgId);
  const seats = await canAddUser(orgId);
  const storage = await storageStatus(orgId);

  const reasons: Record<string, string> = {};
  if (!ai.allowed && ai.reason) reasons.ai = ai.reason;

  const uploadOk = billingActive && !storage.over;
  if (!uploadOk) {
    reasons.upload = storage.over
      ? `Storage limit reached for the ${storage.plan} plan. Existing files are safe — remove files or upgrade to upload more.`
      : "New uploads are paused while billing is inactive. Existing files stay accessible.";
  }

  const inviteOk = billingActive && seats.allowed;
  if (!inviteOk) {
    reasons.invite = !billingActive
      ? "Inviting new users is paused while billing is inactive."
      : seats.reason ?? "User limit reached.";
  }

  return {
    billingActive,
    subscriptionStatus: sub?.status ?? null,
    canUseLiveAI: ai.allowed,
    canGeneratePMsWithAI: ai.allowed,
    canGenerateScenariosWithAI: ai.allowed,
    canUploadFiles: uploadOk,
    canInviteUsers: inviteOk,
    // Safety-critical + manual — never gated by billing.
    canCreateManualWorkOrders: true,
    canCreateManualHandoverNotes: true,
    canViewExistingMaintenanceHistory: true,
    reasons,
  };
}

// Targeted gate for the upload route (billing grace + incremental storage cap).
export async function uploadEntitlement(
  orgId: string,
  incomingBytes: number
): Promise<{ allowed: boolean; code: number; reason: string | null }> {
  if (!(await hasActiveAccess(orgId))) {
    return { allowed: false, code: 402, reason: "New uploads are paused while billing is inactive. Existing files stay accessible — update billing to resume uploads." };
  }
  const up = await canUpload(orgId, incomingBytes);
  return { allowed: up.allowed, code: 413, reason: up.reason };
}

// Targeted gate for inviting a user (billing grace + seat cap).
export async function inviteEntitlement(
  orgId: string
): Promise<{ allowed: boolean; reason: string | null; limit: number | null; used: number }> {
  const seats = await canAddUser(orgId);
  if (!(await hasActiveAccess(orgId))) {
    return { allowed: false, reason: "Inviting new users is paused while billing is inactive. Update billing to add teammates.", limit: seats.limit, used: seats.used };
  }
  return { allowed: seats.allowed, reason: seats.reason, limit: seats.limit, used: seats.used };
}
