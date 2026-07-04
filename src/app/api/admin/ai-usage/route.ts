import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";
import { monthUsage, questionsThisMonth, lastSuccessAt } from "@/lib/ai/usage";
import { getSubscription } from "@/lib/billing/subscription";
import { getPlan, aiQuestionCap } from "@/lib/billing/plans";
import {
  activeProviderName,
  activeProviderModel,
  hasLiveProvider,
  lastProviderError,
} from "@/lib/ai/providers";

export const runtime = "nodejs";

// GET /api/admin/ai-usage — admin AI status + this org's month-to-date usage,
// cost, and quota. Admin-only, strictly org-scoped.
export const GET = safeHandler("admin.ai-usage", async () => {
  const gate = await requirePermission("manage_users");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;

  const sub = await getSubscription(orgId);
  const planKey = sub?.plan ?? "free_trial";
  const plan = getPlan(planKey);
  const cap = aiQuestionCap(planKey);
  const used = await questionsThisMonth(orgId);
  const usage = await monthUsage(orgId);

  const killSwitch = process.env.AI_KILL_SWITCH === "1";
  const overQuota = cap != null && used >= cap;
  const mode = hasLiveProvider() && !killSwitch && !overQuota ? "live" : "fallback";

  return NextResponse.json({
    provider: {
      configured: hasLiveProvider(),
      name: activeProviderName(),
      model: activeProviderModel(),
      mode,
      lastProviderError: lastProviderError(),
      lastSuccessAt: lastSuccessAt(),
      killSwitch,
    },
    plan: { key: plan.key, name: plan.name, priceLabel: plan.priceLabel },
    quota: {
      aiQuestionsPerMonth: cap,
      used,
      remaining: cap == null ? null : Math.max(0, cap - used),
      overQuota,
    },
    usage: {
      questions: usage.questions,
      liveQuestions: usage.liveQuestions,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: Number(usage.costUsd.toFixed(4)),
      byModel: usage.byModel.map((m) => ({ ...m, costUsd: Number(m.costUsd.toFixed(4)) })),
    },
  });
});
