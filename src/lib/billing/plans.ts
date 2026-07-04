// Commercial plan catalog. Quotas here are ENFORCED (AI question cap, users,
// storage) and shown in admin usage reporting. Prices are display-only; billing
// is handled by Stripe. A plan's `aiQuestionsPerMonth` is the hard cap the cost
// controls enforce per organization each calendar month.

export interface Plan {
  key: string;
  name: string;
  priceLabel: string;
  priceUsd: number | null; // null = custom
  sites: number | null; // null = multiple/custom
  users: number | null;
  aiQuestionsPerMonth: number | null; // null = unlimited (enterprise/custom)
  storageGb: number | null;
  features: string[];
}

export const PLANS: Record<string, Plan> = {
  // The 14-day free trial maps to Pilot-level limits so a trialing org is usable.
  free_trial: {
    key: "free_trial",
    name: "Free Trial",
    priceLabel: "14-day trial",
    priceUsd: 0,
    sites: 1,
    users: 10,
    aiQuestionsPerMonth: 1000,
    storageGb: 25,
    features: ["All core workflows", "AI Copilot", "Shift handover", "Knowledge uploads"],
  },
  pilot: {
    key: "pilot",
    name: "Design Partner / Pilot",
    priceLabel: "$1,500/mo per site",
    priceUsd: 1500,
    sites: 1,
    users: 10,
    aiQuestionsPerMonth: 1000,
    storageGb: 25,
    features: [
      "1 organization · 1 plant/site",
      "10 users",
      "1,000 AI Copilot questions/month",
      "25 GB document storage",
      "Work orders, PMs, handover, assets, knowledge uploads",
      "Email support",
    ],
  },
  professional: {
    key: "professional",
    name: "Professional Plant",
    priceLabel: "$3,500/mo per site",
    priceUsd: 3500,
    sites: 1,
    users: 25,
    aiQuestionsPerMonth: 5000,
    storageGb: 100,
    features: [
      "1 organization · 1 plant/site",
      "25 users",
      "5,000 AI Copilot questions/month",
      "100 GB document storage",
      "Advanced document intelligence",
      "Shift handover · PM generation · Parts memory",
      "Admin analytics",
      "Priority support",
    ],
  },
  multi_site: {
    key: "multi_site",
    name: "Multi-Site",
    priceLabel: "$8,000–$15,000/mo",
    priceUsd: null,
    sites: null,
    users: 100,
    aiQuestionsPerMonth: 20000,
    storageGb: 500,
    features: [
      "Multiple plants · cross-site visibility",
      "Corporate dashboard",
      "Site-level permissions",
      "Higher AI usage",
      "Dedicated onboarding",
    ],
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    priceUsd: null,
    sites: null,
    users: null,
    aiQuestionsPerMonth: null, // unlimited / custom
    storageGb: null,
    features: [
      "SSO · custom security review · SLA",
      "Private deployment option",
      "API integrations · CMMS/ERP integrations",
      "Custom AI usage limits",
    ],
  },
  // Legacy alias so existing "pro" subscriptions resolve to Professional.
  pro: {
    key: "pro",
    name: "Professional Plant",
    priceLabel: "$3,500/mo per site",
    priceUsd: 3500,
    sites: 1,
    users: 25,
    aiQuestionsPerMonth: 5000,
    storageGb: 100,
    features: ["Professional Plant"],
  },
};

export function getPlan(planKey: string | null | undefined): Plan {
  return (planKey && PLANS[planKey]) || PLANS.free_trial;
}

// The AI-question cap for an org's plan, with an optional env override that can
// only LOWER it (a global safety ceiling), never raise it beyond the plan.
export function aiQuestionCap(planKey: string | null | undefined): number | null {
  const planCap = getPlan(planKey).aiQuestionsPerMonth;
  const envCap = Number(process.env.AI_MONTHLY_QUESTIONS_PER_ORG || "");
  if (Number.isFinite(envCap) && envCap > 0) {
    return planCap == null ? envCap : Math.min(planCap, envCap);
  }
  return planCap;
}

// Per-plan configurable overrides for the "configurable" tiers (Multi-Site,
// Enterprise) via env, e.g. PLAN_USERS_MULTI_SITE=250, PLAN_STORAGE_GB_ENTERPRISE=2000.
function envNum(name: string): number | null {
  const v = Number(process.env[name] || "");
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Max users for a plan. null = unlimited (Enterprise). Env can raise/lower the
// configurable tiers.
export function planUserLimit(planKey: string | null | undefined): number | null {
  const plan = getPlan(planKey);
  const override = envNum(`PLAN_USERS_${plan.key.toUpperCase()}`);
  if (override != null) return override;
  return plan.users; // null for enterprise = unlimited
}

// Max storage in BYTES for a plan. null = unlimited. Env override in GB.
export function planStorageBytes(planKey: string | null | undefined): number | null {
  const plan = getPlan(planKey);
  const overrideGb = envNum(`PLAN_STORAGE_GB_${plan.key.toUpperCase()}`);
  const gb = overrideGb ?? plan.storageGb;
  return gb == null ? null : Math.round(gb * 1_000_000_000); // GB (decimal) → bytes
}
