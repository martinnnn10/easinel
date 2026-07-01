// ─────────────────────────────────────────────────────────────────────────
// Cross-Customer OEM Intelligence — the moat, activated (safely).
//
// The daily loop already emits a narrow, anonymized OEM failure→fix signal on
// every closed corrective work order (make/model/fault-code + a coarse outcome),
// with NO customer identifier, asset id, plant, or free text. This module turns
// that pool into an answer: "across plants running this exact drive, F007 was
// resolved by <cooling> in N% of cases, median downtime M min."
//
// Privacy guarantees enforced HERE (not just promised):
//   • CONSENT-ONLY: only rows with sharedConsent = true are ever pooled.
//   • K-ANONYMITY: an aggregate is returned ONLY when it draws on at least
//     MIN_SIGNALS signals AND MIN_PLANTS distinct contributing plants — below
//     that we return "insufficient" so a single plant can't be reverse-derived.
//   • NO IDENTIFIERS OUT: originOrgId is used only to COUNT distinct plants; it
//     is never returned. Outputs are counts, percentages, and medians.
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import { oemFailureSignals } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const MIN_SIGNALS = 3;
const MIN_PLANTS = 2;

export interface NetworkFilter {
  manufacturer?: string | null;
  model?: string | null;
  assetType?: string | null;
  faultCode?: string | null;
}

export interface NetworkResult {
  available: boolean;
  reason?: string;
  match: NetworkFilter;
  signalCount: number;
  plantCount: number;
  resolutionBreakdown: { category: string; count: number; pct: number }[];
  medianDowntimeMins: number | null;
  medianLaborMins: number | null;
}

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

// Query the pooled, consented signals matching the given OEM dimensions and
// return an anonymized aggregate — or an honest "insufficient" result.
export async function networkIntelligence(filter: NetworkFilter): Promise<NetworkResult> {
  await ensureDb();
  const match: NetworkFilter = {
    manufacturer: filter.manufacturer?.trim() || null,
    model: filter.model?.trim() || null,
    assetType: filter.assetType?.trim() || null,
    faultCode: filter.faultCode?.trim() || null,
  };

  const empty: NetworkResult = {
    available: false,
    match,
    signalCount: 0,
    plantCount: 0,
    resolutionBreakdown: [],
    medianDowntimeMins: null,
    medianLaborMins: null,
  };

  // Need at least one identifying OEM dimension to match on.
  if (!match.manufacturer && !match.model && !match.faultCode) {
    return { ...empty, reason: "Provide a manufacturer, model, or fault code to query the network." };
  }

  // CONSENT-ONLY pooling.
  const conds = [eq(oemFailureSignals.sharedConsent, true)];
  if (match.manufacturer) conds.push(eq(oemFailureSignals.manufacturer, match.manufacturer));
  if (match.model) conds.push(eq(oemFailureSignals.model, match.model));
  if (match.assetType) conds.push(eq(oemFailureSignals.assetType, match.assetType));
  if (match.faultCode) conds.push(eq(oemFailureSignals.faultCode, match.faultCode));

  const rows = await db
    .select({
      resolutionCategory: oemFailureSignals.resolutionCategory,
      downtimeMins: oemFailureSignals.downtimeMins,
      laborMins: oemFailureSignals.laborMins,
      originOrgId: oemFailureSignals.originOrgId, // used ONLY to count distinct plants
    })
    .from(oemFailureSignals)
    .where(and(...conds));

  const signalCount = rows.length;
  const plantCount = new Set(rows.map((r) => r.originOrgId)).size;

  // K-ANONYMITY gate — never return an aggregate that could isolate one plant.
  if (signalCount < MIN_SIGNALS || plantCount < MIN_PLANTS) {
    return {
      ...empty,
      signalCount,
      plantCount,
      reason: `Not enough network data yet (needs ≥${MIN_SIGNALS} signals from ≥${MIN_PLANTS} plants to stay anonymous).`,
    };
  }

  const catCounts = new Map<string, number>();
  for (const r of rows) {
    const c = r.resolutionCategory || "other";
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const resolutionBreakdown = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count, pct: Math.round((count / signalCount) * 100) }))
    .sort((a, b) => b.count - a.count);

  return {
    available: true,
    match,
    signalCount,
    plantCount,
    resolutionBreakdown,
    medianDowntimeMins: median(rows.map((r) => Number(r.downtimeMins)).filter((n) => n > 0)),
    medianLaborMins: median(rows.map((r) => Number(r.laborMins)).filter((n) => n > 0)),
  };
}

// A short, human sentence for the Copilot / UI. Honest about the anonymized,
// opt-in nature and never over-claims.
export function summarizeNetwork(r: NetworkResult): string {
  if (!r.available) return r.reason ?? "No network intelligence available.";
  const top = r.resolutionBreakdown[0];
  const dims = [r.match.manufacturer, r.match.model].filter(Boolean).join(" ") || r.match.faultCode || "this equipment";
  const parts = [
    `Across ${r.plantCount} plants and ${r.signalCount} anonymized resolutions for ${dims}${r.match.faultCode ? ` / ${r.match.faultCode}` : ""}:`,
  ];
  if (top) parts.push(`most fixes were ${top.category} (${top.pct}%)`);
  if (r.medianDowntimeMins != null) parts.push(`median downtime ~${r.medianDowntimeMins} min`);
  return parts.join(" ") + ".";
}
