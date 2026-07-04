import { db, ensureDb } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { id } from "@/lib/util";
import { estimateCostUsd } from "./model";
import { getSubscription } from "@/lib/billing/subscription";
import { aiQuestionCap, getPlan } from "@/lib/billing/plans";

// Start of the current calendar month (UTC) in epoch ms. NOTE: uses Date at
// runtime (app server, not a workflow script) — that's fine here.
function startOfMonthMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export interface RecordUsageInput {
  orgId: string;
  userId?: string | null;
  route?: string;
  model: string; // e.g. "claude-opus-4-8" | "claude-sonnet-4-5" | "deterministic"
  mode: "live" | "fallback" | "deterministic";
  promptTokens: number;
  completionTokens: number;
}

export async function recordAiUsage(input: RecordUsageInput): Promise<void> {
  if (!input.orgId) return;
  await ensureDb();
  const costUsd = estimateCostUsd(input.model, input.promptTokens, input.completionTokens);
  await db.insert(aiUsage).values({
    id: id("aiu"),
    orgId: input.orgId,
    userId: input.userId ?? null,
    route: input.route ?? "chat",
    model: input.model,
    mode: input.mode,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    costUsd,
  });
}

export interface MonthUsage {
  questions: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  liveQuestions: number;
  byModel: { model: string; questions: number; tokens: number; costUsd: number }[];
}

export async function monthUsage(orgId: string): Promise<MonthUsage> {
  if (!orgId) throw new Error("monthUsage() requires orgId");
  await ensureDb();
  const since = startOfMonthMs();
  const rows = await db
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, since)));

  const byModel = new Map<string, { questions: number; tokens: number; costUsd: number }>();
  let questions = 0, promptTokens = 0, completionTokens = 0, costUsd = 0, liveQuestions = 0;
  for (const r of rows) {
    questions++;
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    costUsd += r.costUsd;
    if (r.mode === "live") liveQuestions++;
    const m = byModel.get(r.model) ?? { questions: 0, tokens: 0, costUsd: 0 };
    m.questions++;
    m.tokens += r.promptTokens + r.completionTokens;
    m.costUsd += r.costUsd;
    byModel.set(r.model, m);
  }
  return {
    questions, promptTokens, completionTokens, costUsd, liveQuestions,
    byModel: Array.from(byModel.entries()).map(([model, v]) => ({ model, ...v })),
  };
}

// Count of Copilot questions this org has asked this month (quota metric).
export async function questionsThisMonth(orgId: string): Promise<number> {
  await ensureDb();
  const since = startOfMonthMs();
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, since)));
  return Number(r[0]?.n ?? 0);
}

export interface LiveDecision {
  allowed: boolean;
  reason: string | null; // why live was denied (kill switch / quota)
  cap: number | null;
  used: number;
  plan: string;
}

// Whether this org may use a LIVE model right now. Denied by the global kill
// switch or when the org has hit its plan's monthly AI-question cap. When denied,
// the caller still answers via the deterministic engine (never a hard failure).
export async function canUseLive(orgId: string): Promise<LiveDecision> {
  const sub = await getSubscription(orgId);
  const planKey = sub?.plan ?? "free_trial";
  const plan = getPlan(planKey);
  const used = await questionsThisMonth(orgId);
  const cap = aiQuestionCap(planKey);

  if (process.env.AI_KILL_SWITCH === "1") {
    return { allowed: false, reason: "AI kill switch is enabled (AI_KILL_SWITCH=1).", cap, used, plan: plan.name };
  }
  if (cap != null && used >= cap) {
    return {
      allowed: false,
      reason: `Monthly AI question limit reached for the ${plan.name} plan (${used}/${cap}).`,
      cap, used, plan: plan.name,
    };
  }
  return { allowed: true, reason: null, cap, used, plan: plan.name };
}

// ── Last successful LIVE answer timestamp (surfaced in health/admin) ──
const g = globalThis as unknown as { __aiLastSuccessAt?: number | null };
export function recordLiveSuccess(): void { g.__aiLastSuccessAt = Date.now(); }
export function lastSuccessAt(): number | null { return g.__aiLastSuccessAt ?? null; }
