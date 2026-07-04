import { describe, it, expect, beforeAll, afterEach } from "vitest";
process.env.DATABASE_URL = ":memory:";

import { selectLiveModel, estimateCostUsd, estimateTokens, opusModel, sonnetModel } from "./model";
import { getPlan, aiQuestionCap, PLANS } from "@/lib/billing/plans";
import { ensureDb } from "@/lib/db";
import { recordAiUsage, monthUsage, questionsThisMonth, canUseLive } from "./usage";
import { createTrialSubscription } from "@/lib/billing/subscription";

describe("model tiering (Sonnet vs Opus)", () => {
  it("uses Sonnet for normal troubleshooting", () => {
    const r = selectLiveModel({ question: "why is my pump leaking at the seal?", contextChars: 500, contextSources: 1, hasImages: false, historyTurns: 0 });
    expect(r.tier).toBe("sonnet");
    expect(r.model).toBe(sonnetModel());
  });
  it("uses Opus for PLC / RCA / multi-document reasoning", () => {
    expect(selectLiveModel({ question: "trace this ladder rung in the L5X routine", contextChars: 500, contextSources: 1, hasImages: false, historyTurns: 0 }).tier).toBe("opus");
    expect(selectLiveModel({ question: "write a 5-why root cause analysis", contextChars: 500, contextSources: 1, hasImages: false, historyTurns: 0 }).tier).toBe("opus");
    expect(selectLiveModel({ question: "compare these", contextChars: 15000, contextSources: 6, hasImages: false, historyTurns: 0 }).tier).toBe("opus");
    expect(selectLiveModel({ question: "what is this?", contextChars: 100, contextSources: 1, hasImages: true, historyTurns: 0 }).tier).toBe("opus");
  });
  it("costs Opus more than Sonnet; deterministic is free", () => {
    expect(estimateCostUsd(opusModel(), 1000, 1000)).toBeGreaterThan(estimateCostUsd(sonnetModel(), 1000, 1000));
    expect(estimateCostUsd("deterministic", 1000, 1000)).toBe(0);
    expect(estimateTokens("abcd".repeat(25))).toBe(25); // 100 chars ~ 25 tokens
  });
});

describe("plan quotas", () => {
  it("maps the pricing tiers to AI question caps", () => {
    expect(PLANS.pilot.aiQuestionsPerMonth).toBe(1000);
    expect(PLANS.professional.aiQuestionsPerMonth).toBe(5000);
    expect(getPlan("enterprise").aiQuestionsPerMonth).toBeNull(); // unlimited
    expect(aiQuestionCap("pilot")).toBe(1000);
  });
  it("env ceiling can only LOWER a plan cap", () => {
    process.env.AI_MONTHLY_QUESTIONS_PER_ORG = "500";
    expect(aiQuestionCap("pilot")).toBe(500);
    expect(aiQuestionCap("professional")).toBe(500);
    delete process.env.AI_MONTHLY_QUESTIONS_PER_ORG;
  });
});

describe("usage tracking + quota enforcement (org-scoped)", () => {
  beforeAll(async () => { await ensureDb(); });
  afterEach(() => { delete process.env.AI_KILL_SWITCH; delete process.env.AI_MONTHLY_QUESTIONS_PER_ORG; });

  it("records usage and reports month totals per org", async () => {
    const org = "org_usage_a";
    await recordAiUsage({ orgId: org, userId: "u1", model: opusModel(), mode: "live", promptTokens: 1000, completionTokens: 500 });
    await recordAiUsage({ orgId: org, userId: "u1", model: "deterministic", mode: "deterministic", promptTokens: 200, completionTokens: 100 });
    const u = await monthUsage(org);
    expect(u.questions).toBe(2);
    expect(u.liveQuestions).toBe(1);
    expect(u.costUsd).toBeGreaterThan(0);
    expect(await questionsThisMonth(org)).toBe(2);
    // cross-org isolation
    expect(await questionsThisMonth("org_usage_b")).toBe(0);
  });

  it("blocks live when the org hits its plan cap", async () => {
    const org = "org_usage_cap";
    await createTrialSubscription(org); // free_trial → 1000 cap
    process.env.AI_MONTHLY_QUESTIONS_PER_ORG = "2"; // lower the cap to 2 for the test
    await recordAiUsage({ orgId: org, model: "deterministic", mode: "deterministic", promptTokens: 1, completionTokens: 1 });
    await recordAiUsage({ orgId: org, model: "deterministic", mode: "deterministic", promptTokens: 1, completionTokens: 1 });
    const d = await canUseLive(org);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/limit reached/i);
  });

  it("kill switch forces fallback", async () => {
    process.env.AI_KILL_SWITCH = "1";
    const d = await canUseLive("org_any");
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/kill switch/i);
  });
});
