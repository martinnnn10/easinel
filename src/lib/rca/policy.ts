// Pure RCA policy decisions — extracted so the security-critical rules are unit
// testable without an HTTP session. The routes call these; the tests call these.

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export interface RcaConfirmInput {
  confirmedRootCause?: unknown;
  status?: unknown;
}

// Saving a *confirmed* root cause (or moving to manager_confirmed) is a
// manager+ action. Filling everything else is allowed to technicians. The route
// combines this with can(role, "manage_pm").
export function rcaConfirmNeedsManager(input: RcaConfirmInput): boolean {
  const confirming = typeof input.confirmedRootCause === "string" && input.confirmedRootCause.trim().length > 0;
  return confirming || input.status === "manager_confirmed";
}

export interface RcaLike {
  failedPart?: string | null;
  confirmedRootCause?: string | null;
  suspectedCause?: string | null;
  correctiveAction?: string | null;
}
export interface WoLike {
  assetId?: string | null;
}
export interface PmLike {
  id: string;
  assetId: string | null;
  failureMode: string | null;
  title: string;
  status: string;
  sourceWorkOrderId?: string | null;
}

export type PmFromRcaResult =
  | { ok: true }
  | { ok: false; code: string; status: number; message: string; existingPmId?: string };

const isLivePm = (p: PmLike) => p.status === "draft" || p.status === "active";

// Whether an RCA should become a PM DRAFT, and why not if it shouldn't. Encodes
// the "suggest when / do not suggest when" rules plus the duplicate guard.
// `workOrderId` enables the strongest dedup: a PM already sourced from THIS work
// order is a duplicate regardless of how its title/failure-mode text reads.
export function evaluatePmFromRca(
  rca: RcaLike | null,
  wo: WoLike,
  programs: PmLike[],
  workOrderId?: string
): PmFromRcaResult {
  if (!rca) return { ok: false, code: "no_rca", status: 422, message: "Complete the RCA before drafting a PM from it." };
  const cause = (rca.confirmedRootCause || rca.suspectedCause || "").trim();
  if (!cause) return { ok: false, code: "no_cause", status: 422, message: "No root cause or suspected cause yet — a PM needs a cause to prevent." };
  if (!(rca.correctiveAction || "").trim()) return { ok: false, code: "no_corrective", status: 422, message: "No corrective action recorded — nothing to convert into prevention yet." };
  if (!wo.assetId) return { ok: false, code: "no_asset", status: 422, message: "Link a machine to this work order first — a PM must belong to an asset." };

  // Strongest guard: this exact work order / RCA already produced a live PM.
  if (workOrderId) {
    const fromSameWo = programs.find((p) => isLivePm(p) && p.sourceWorkOrderId === workOrderId);
    if (fromSameWo) {
      return { ok: false, code: "duplicate", status: 409, message: `A ${fromSameWo.status} PM was already created from this work order.`, existingPmId: fromSameWo.id };
    }
  }

  // Failure-mode guard: an active/draft PM already covers this failure mode on
  // this machine.
  const sig = norm(rca.failedPart || cause).split(" ").filter((w) => w.length > 3)[0];
  const dupe = programs.find(
    (p) => p.assetId === wo.assetId && isLivePm(p) && sig && (norm(p.failureMode).includes(sig) || norm(p.title).includes(sig))
  );
  if (dupe) {
    return { ok: false, code: "duplicate", status: 409, message: `A ${dupe.status} PM already covers this failure mode on this machine.`, existingPmId: dupe.id };
  }
  return { ok: true };
}
