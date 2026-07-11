// AI RCA draft — a SUGGESTION a human verifies before saving. It reuses the
// grounded generateRca() engine (asset history + lessons + docs), then maps the
// result into the structured RCA form. Hard rules (Constitution):
//   • It fills SUSPECTED cause only — never confirmedRootCause. A person confirms.
//   • It never invents a failed part, PM task, terminal number, or savings — the
//     failed part comes straight from the work order, or stays empty.
//   • If the record is too thin to ground a cause, it says so.

import { generateRca } from "@/lib/rca/generate";
import { getWorkOrder } from "@/lib/workorders/repository";

export interface RcaDraft {
  aiSuggested: true;
  grounded: boolean;
  label: string;
  note: string | null;
  problemStatement: string | null;
  symptomObserved: string | null;
  failedPart: string | null;
  suspectedCause: string | null;
  confirmedRootCause: null; // AI can never confirm
  correctiveAction: string | null;
  preventiveAction: string | null;
  verificationMethod: string | null;
  confidence: "high" | "medium" | "low";
}

export async function draftRca(orgId: string, workOrderId: string): Promise<RcaDraft | null> {
  const wo = await getWorkOrder(orgId, workOrderId);
  if (!wo) return null;
  const report = await generateRca(orgId, workOrderId);
  if (!report) return null;

  const failedPart = wo.failedPart?.trim() || null; // only ever the recorded part
  const suspected = report.grounded ? report.rootCause : null;
  const corrective = report.correctiveAction || wo.repairAction?.trim() || wo.resolution?.trim() || null;

  // A preventive suggestion is only offered when it's anchored to a real failed
  // part or a recorded cause — never a fabricated task list.
  const preventive =
    failedPart
      ? `Add routine inspection/replacement of the ${failedPart} to this machine's PM route; verify condition and adjustment before failure.`
      : suspected
        ? `Add a PM check that would catch "${suspected}" early (inspection / cleaning / calibration as appropriate).`
        : null;

  return {
    aiSuggested: true,
    grounded: report.grounded,
    label: "Suggested RCA draft — verify before saving.",
    note: report.grounded
      ? null
      : "Root cause not confirmed. Suggested possibilities only — the work order doesn't yet record enough to ground a cause.",
    problemStatement: report.problemStatement || wo.title || null,
    symptomObserved: wo.symptom?.trim() || null,
    failedPart,
    suspectedCause: suspected,
    confirmedRootCause: null,
    correctiveAction: corrective,
    preventiveAction: preventive,
    verificationMethod: "Function-test under load after the fix; record baseline readings (amps, temperature, vibration) and confirm the fault does not recur.",
    confidence: report.confidence,
  };
}
