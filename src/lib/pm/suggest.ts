// AI PM suggestion — turns a closed corrective work order into a GROUNDED,
// human-approvable preventive program. Never activates anything; it only
// produces a `draft` proposal with explicit evidence and a confidence level.
//
// Grounding priority (per the AI rules): lessons learned → asset WO history →
// manuals/OEM docs → PM history → general knowledge only when plant data is thin.

import { getWorkOrder, listWorkOrders } from "@/lib/workorders/repository";
import { getAsset } from "@/lib/assets/repository";
import { hybridRetrieve } from "@/lib/rag/hybrid";
import { listPrograms, type NewPmProgram, type PmEvidence } from "./repository";
import { getLiveChatProvider } from "@/lib/ai/providers";

export interface PmSuggestion extends NewPmProgram {
  evidenceCount: number;
}

function frequencyFor(failedPart: string | null, rootCause: string | null): {
  label: string;
  days: number;
} {
  const s = `${failedPart ?? ""} ${rootCause ?? ""}`.toLowerCase();
  if (/belt|chain|filter|grease|lubric/.test(s)) return { label: "Monthly", days: 30 };
  if (/seal|gasket|hose|diaphragm/.test(s)) return { label: "Semi-annual", days: 180 };
  if (/bearing|coupling|gearbox|sensor|photoeye|proximity|encoder/.test(s))
    return { label: "Quarterly", days: 90 };
  return { label: "Quarterly", days: 90 };
}

export async function suggestPmFromWorkOrder(
  workOrderId: string,
  orgId: string
): Promise<PmSuggestion | null> {
  const wo = await getWorkOrder(orgId, workOrderId);
  if (!wo) return null;

  const asset = wo.assetId ? await getAsset(orgId, wo.assetId) : undefined;
  const rootCause = wo.rootCause ?? null;
  const failedPart = wo.failedPart ?? null;
  const repairAction = wo.repairAction ?? wo.resolution ?? null;

  // ── Gather grounded evidence in priority order ──
  const evidence: PmEvidence[] = [
    {
      kind: "work_order",
      refId: wo.id,
      detail: `${wo.number ?? wo.id}: ${wo.title}${rootCause ? ` — root cause: ${rootCause}` : ""}`,
    },
  ];

  // Asset WO history (repeat failures strengthen the case)
  let repeatCount = 0;
  if (wo.assetId) {
    const history = await listWorkOrders(orgId, { assetId: wo.assetId });
    const related = history.filter(
      (h) =>
        h.id !== wo.id &&
        ((failedPart && (h.failedPart === failedPart || (h.title || "").toLowerCase().includes(failedPart.toLowerCase()))) ||
          (rootCause && (h.rootCause === rootCause)))
    );
    repeatCount = related.length;
    for (const h of related.slice(0, 5)) {
      evidence.push({ kind: "work_order", refId: h.id, detail: `${h.number ?? h.id}: ${h.title}` });
    }
  }

  // Lessons + manuals via retrieval (kind tells us which)
  const query = [wo.title, wo.symptom, rootCause, failedPart].filter(Boolean).join(" ");
  let lessonCount = 0;
  if (query) {
    const { chunks } = await hybridRetrieve(query, { orgId, assetId: wo.assetId ?? null, limit: 5 });
    for (const c of chunks) {
      const kind = /lesson/i.test(c.filename) ? "lesson" : "manual";
      if (kind === "lesson") lessonCount++;
      evidence.push({ kind, refId: c.documentId, detail: `${c.filename}` });
    }
  }

  // Existing PM history for this asset
  if (wo.assetId) {
    const pms = (await listPrograms(orgId)).filter((p) => p.assetId === wo.assetId);
    for (const p of pms.slice(0, 3))
      evidence.push({ kind: "pm_history", refId: p.id, detail: p.title });
  }

  const freq = frequencyFor(failedPart, rootCause);
  const confidence: "high" | "medium" | "low" =
    lessonCount > 0 || repeatCount >= 2 ? "high" : evidence.length > 2 ? "medium" : "low";

  const failureMode =
    rootCause || (failedPart ? `${failedPart} failure` : wo.title) || "Recurring failure";

  const tasks = [
    "Perform LOTO and verify zero energy state (electrical, stored, gravity/spring).",
    failedPart
      ? `Inspect ${failedPart} for wear, damage, alignment, and looseness; replace if out of spec.`
      : "Inspect the previously failed component for wear, damage, and looseness.",
    repairAction
      ? `Verify the prior corrective action held: ${repairAction.slice(0, 140)}.`
      : "Verify the prior corrective action is still effective.",
    "Clean, lubricate, and torque per OEM spec (correct grade/amount — do not over-grease).",
    "Function-test under load and record baseline readings (amps, temperature, vibration).",
    "Document findings; raise a corrective work order for anything out of spec.",
  ];

  let reasoning =
    `This PM targets the failure mode "${failureMode}"${
      asset ? ` on ${asset.name}` : ""
    }. It is proposed from a closed corrective work order` +
    (repeatCount >= 1 ? ` and ${repeatCount} related prior work order(s)` : "") +
    (lessonCount > 0 ? ` plus ${lessonCount} lesson(s) learned` : "") +
    `. A ${freq.label.toLowerCase()} cadence is suggested as a starting point; adjust to your run-hours and RCM criticality before approving.`;

  // Optional: let a live LLM (any configured provider) rewrite the rationale,
  // grounded strictly in the evidence. Falls back to deterministic prose.
  const provider = getLiveChatProvider();
  if (provider) {
    try {
      const ev = evidence.map((e) => `- [${e.kind}] ${e.detail ?? ""}`).join("\n");
      let text = "";
      const gen = provider.stream({
        system:
          "You are a reliability engineer. In 3-4 sentences, justify a preventive maintenance program based ONLY on the evidence provided. Be specific and cite the failure mode. Do not invent part numbers or data not present.",
        maxTokens: 350,
        messages: [
          {
            role: "user",
            content: `Failure mode: ${failureMode}\nAsset: ${asset?.name ?? "unknown"} (${asset?.manufacturer ?? ""} ${asset?.model ?? ""})\nProposed cadence: ${freq.label}\nEvidence:\n${ev}`,
          },
        ],
      });
      for await (const delta of gen) text += delta;
      if (text.trim()) reasoning = text.trim();
    } catch {
      /* keep deterministic reasoning */
    }
  }

  return {
    assetId: wo.assetId ?? null,
    title: `PM — ${failureMode}${asset ? ` (${asset.name})` : ""}`.slice(0, 90),
    failureMode,
    frequencyLabel: freq.label,
    intervalDays: freq.days,
    estLaborMins: wo.estLaborMins ?? 45,
    tools: ["Multimeter (CAT III)", "Clamp ammeter", "IR thermometer", "Hand tools", "Torque wrench"],
    parts: failedPart ? [failedPart] : [],
    safety: [
      "LOTO and verify zero energy before contact work.",
      "Discharge stored energy (capacitors, accumulators, springs, suspended loads).",
      "Arc-flash rated PPE for any energized verification.",
    ],
    reasoning,
    confidence,
    source: "ai_suggested",
    sourceWorkOrderId: wo.id,
    tasks,
    evidence,
    evidenceCount: evidence.length,
  };
}
