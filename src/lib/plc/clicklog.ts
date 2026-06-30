import { db, ensureDb } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { id } from "@/lib/util";

// ─────────────────────────────────────────────────────────────────────────
// Click-path logging for the PLC Explorer.
//
// Requirement #9: every click must be logged and classified so we can tell
// WHY a click did (or did not) resolve:
//   - ok                 → node resolved and returned data
//   - missing_project    → no parsed PLC project for that id (missing parser output)
//   - missing_node       → project exists but the node id isn't in the IR
//   - empty_content      → node resolved but has no logic/members (graceful notice)
//   - bad_request        → malformed node id / params (missing route/state on client)
//   - error              → unexpected server error
//
// Logs go to the existing audit_log table (so they're queryable) AND to the
// server console with a [plc-click] prefix for live debugging.
// ─────────────────────────────────────────────────────────────────────────

export type ClickOutcome =
  | "ok"
  | "missing_project"
  | "missing_node"
  | "empty_content"
  | "bad_request"
  | "error";

export interface ClickLogInput {
  projectId?: string;
  nodeId?: string;
  nodeType?: string;
  outcome: ClickOutcome;
  detail?: string;
  ms?: number;
}

export async function logClick(orgId: string, input: ClickLogInput): Promise<void> {
  const line = `[plc-click] outcome=${input.outcome} project=${input.projectId ?? "-"} node=${
    input.nodeId ?? "-"
  } type=${input.nodeType ?? "-"}${input.ms != null ? ` ${input.ms}ms` : ""}${
    input.detail ? ` :: ${input.detail}` : ""
  }`;
  if (input.outcome === "ok") console.log(line);
  else console.warn(line);

  try {
    await ensureDb();
    if (!orgId) return; // logging must never break the request
    await db.insert(auditLog).values({
      id: id("aud"),
      orgId,
      actor: "user",
      action: `plc.click.${input.outcome}`,
      target: input.nodeId ?? input.projectId ?? null,
      detail: JSON.stringify({
        projectId: input.projectId,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        outcome: input.outcome,
        detail: input.detail,
        ms: input.ms,
      }).slice(0, 800),
    });
  } catch {
    /* logging must never break the request */
  }
}
