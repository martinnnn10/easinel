// ─────────────────────────────────────────────────────────────────────────
// Automated Root Cause Analysis (RCA) generation.
//
// Turns a CLOSED corrective work order — plus the asset's real failure history
// and captured lessons — into a formal, evidence-linked RCA (problem statement,
// timeline, contributing factors, a 5-Why scaffold, root cause, corrective
// action, and a preventive recommendation).
//
// Honesty (Constitution): the RCA is built STRICTLY from recorded data. It never
// invents root causes or why-levels that weren't captured — where the record is
// thin, it says so and prompts the human to investigate. An optional live LLM
// may write a richer narrative, but only grounded in the same evidence; the
// deterministic version always works with no key and no fabrication.
// ─────────────────────────────────────────────────────────────────────────

import { getWorkOrder, listWorkOrders } from "@/lib/workorders/repository";
import { getAsset } from "@/lib/assets/repository";
import { hybridRetrieve } from "@/lib/rag/hybrid";
import { getLiveChatProvider } from "@/lib/ai/providers";
import type { WorkOrder } from "@/lib/db/schema";

export interface RcaEvidence {
  kind: "work_order" | "lesson" | "manual" | "asset";
  refId: string;
  detail: string;
}

export interface RcaReport {
  workOrderId: string;
  assetId: string | null;
  title: string;
  markdown: string;
  problemStatement: string;
  rootCause: string | null;
  correctiveAction: string | null;
  repeatCount: number;
  evidence: RcaEvidence[];
  confidence: "high" | "medium" | "low";
  /** True when a live model wrote the analysis narrative; false = deterministic. */
  aiGenerated: boolean;
  grounded: boolean; // false when the WO lacks a recorded root cause
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}
function dt(v: unknown): string {
  const n = ms(v);
  return n ? new Date(n).toISOString().slice(0, 16).replace("T", " ") : "—";
}

// Gather the real, recorded facts. No fabrication.
export async function generateRca(orgId: string, workOrderId: string): Promise<RcaReport | null> {
  if (!orgId) throw new Error("generateRca() requires orgId");
  const wo = await getWorkOrder(orgId, workOrderId);
  if (!wo) return null;

  const asset = wo.assetId ? await getAsset(orgId, wo.assetId) : undefined;
  const rootCause = wo.rootCause?.trim() || null;
  const failedPart = wo.failedPart?.trim() || null;
  const correctiveAction = (wo.repairAction || wo.resolution)?.trim() || null;

  const evidence: RcaEvidence[] = [
    {
      kind: "work_order",
      refId: wo.id,
      detail: `${wo.number ?? wo.id}: ${wo.title}${rootCause ? ` — root cause: ${rootCause}` : ""}`,
    },
  ];

  // Repeat/related failures on the same asset strengthen the RCA.
  let repeatCount = 0;
  const related: WorkOrder[] = [];
  if (wo.assetId) {
    const history = await listWorkOrders(orgId, { assetId: wo.assetId });
    for (const h of history) {
      if (h.id === wo.id) continue;
      const match =
        (failedPart && (h.failedPart === failedPart || (h.title || "").toLowerCase().includes(failedPart.toLowerCase()))) ||
        (rootCause && h.rootCause === rootCause) ||
        (wo.symptom && h.symptom && h.symptom.toLowerCase().slice(0, 20) === wo.symptom.toLowerCase().slice(0, 20));
      if (match) related.push(h);
    }
    repeatCount = related.length;
    for (const h of related.slice(0, 5)) {
      evidence.push({ kind: "work_order", refId: h.id, detail: `${h.number ?? h.id} (${dt(h.closedAt ?? h.createdAt)}): ${h.title}` });
    }
  }

  // Lessons + manuals grounding via retrieval.
  const query = [wo.title, wo.symptom, rootCause, failedPart].filter(Boolean).join(" ");
  if (query) {
    try {
      const { chunks } = await hybridRetrieve(query, { orgId, assetId: wo.assetId ?? null, limit: 4 });
      for (const c of chunks) {
        evidence.push({ kind: /lesson/i.test(c.filename) ? "lesson" : "manual", refId: c.documentId, detail: c.filename });
      }
    } catch {
      /* retrieval optional */
    }
  }

  const grounded = Boolean(rootCause);
  const confidence: "high" | "medium" | "low" =
    grounded && repeatCount >= 2 ? "high" : grounded || repeatCount >= 1 ? "medium" : "low";

  const problemStatement =
    `${asset ? asset.name : "Asset"}${asset?.assetTag ? ` [${asset.assetTag}]` : ""} failed` +
    (wo.symptom ? `: ${wo.symptom}` : ` (${wo.title})`) +
    (wo.downtimeMins != null ? ` — ${wo.downtimeMins} min downtime.` : ".");

  // 5-Why scaffold built ONLY from recorded facts; gaps are labeled, not invented.
  const whys: string[] = [];
  whys.push(`**Why did the machine go down?** ${wo.symptom || wo.title}.`);
  if (failedPart) whys.push(`**Why?** ${failedPart} failed.`);
  if (rootCause) whys.push(`**Why?** ${rootCause}.`);
  whys.push(
    grounded
      ? `**Why did that root cause occur?** _Not recorded — investigate and add to close-out to deepen this RCA._`
      : `**Root cause not recorded on this work order.** Capture the root cause on close-out to complete the analysis.`
  );

  const contributing =
    repeatCount > 0
      ? `This is a **repeat failure** — ${repeatCount} related work order(s) on this asset. Recurrence indicates the prior corrective actions did not address the true root cause.`
      : `No prior related failures were found on this asset in the record.`;

  let analysis =
    `The failure ${grounded ? `is attributed to **${rootCause}**` : `does not yet have a recorded root cause`}. ` +
    contributing;

  // Optional live-LLM narrative, grounded strictly in the evidence.
  let aiGenerated = false;
  const provider = getLiveChatProvider();
  if (provider && grounded) {
    try {
      const ev = evidence.map((e) => `- [${e.kind}] ${e.detail}`).join("\n");
      let text = "";
      const gen = provider.stream({
        system:
          "You are a reliability engineer writing the analysis section of a formal RCA. In 4-6 sentences, explain the likely causal chain and why this failure recurred (if it did), based ONLY on the evidence given. Do NOT invent part numbers, measurements, or facts not present. Recommend what to verify next.",
        maxTokens: 450,
        messages: [
          {
            role: "user",
            content: `Problem: ${problemStatement}\nRecorded root cause: ${rootCause}\nFailed part: ${failedPart ?? "—"}\nCorrective action taken: ${correctiveAction ?? "—"}\nRepeat failures: ${repeatCount}\nEvidence:\n${ev}`,
          },
        ],
      });
      for await (const delta of gen) text += delta;
      if (text.trim()) {
        analysis = text.trim();
        aiGenerated = true;
      }
    } catch {
      /* keep deterministic analysis */
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const markdown = [
    `# Root Cause Analysis — ${wo.number ?? wo.id}`,
    `Asset: ${asset ? `${asset.name}${asset.assetTag ? ` [${asset.assetTag}]` : ""}` : "—"}  ·  Prepared: ${date}  ·  Confidence: ${confidence}`,
    ``,
    `## 1. Problem statement`,
    problemStatement,
    ``,
    `## 2. Timeline`,
    `- Reported: ${dt(wo.reportedAt ?? wo.createdAt)}`,
    `- Work started: ${dt(wo.startedAt)}`,
    `- Restored (closed): ${dt(wo.closedAt)}`,
    `- Downtime: ${wo.downtimeMins != null ? `${wo.downtimeMins} min` : "—"}`,
    ``,
    `## 3. 5-Why analysis`,
    ...whys.map((w) => `- ${w}`),
    ``,
    `## 4. Contributing factors & analysis`,
    analysis,
    ``,
    `## 5. Root cause`,
    grounded ? rootCause! : "_Not recorded on the work order. Capture it on close-out to complete this RCA._",
    ``,
    `## 6. Corrective action taken`,
    correctiveAction || "_Not recorded._",
    ``,
    `## 7. Preventive recommendation`,
    grounded
      ? `Create or verify a preventive-maintenance task targeting **${rootCause}**${failedPart ? ` / ${failedPart}` : ""}. ${repeatCount >= 1 ? "Because this has recurred, prioritize it and verify the corrective action holds under load." : "Set a cadence appropriate to run-hours and criticality."}`
      : `Record the root cause, then generate a preventive program from this work order.`,
    ``,
    `## 8. Evidence`,
    ...evidence.map((e) => `- [${e.kind}] ${e.detail}`),
    ``,
    `---`,
    aiGenerated
      ? `_Analysis section written by the AI, grounded in the evidence above. Verify against plant reality before acting._`
      : `_Deterministic RCA built from recorded work-order data. Add a live model key for a richer analysis narrative._`,
  ].join("\n");

  return {
    workOrderId: wo.id,
    assetId: wo.assetId ?? null,
    title: `RCA — ${wo.title}`.slice(0, 120),
    markdown,
    problemStatement,
    rootCause,
    correctiveAction,
    repeatCount,
    evidence,
    confidence,
    aiGenerated,
    grounded,
  };
}
