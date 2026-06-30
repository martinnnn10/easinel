import { createHmac } from "crypto";
import { db, ensureDb } from "@/lib/db";
import { events, webhooks, auditLog } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/util";

export type EventType =
  | "workorder.created"
  | "workorder.updated"
  | "workorder.synced"
  | "workorder.requested"
  | "workorder.approved"
  | "workorder.rejected"
  | "asset.created"
  | "asset.updated"
  | "asset.deleted"
  | "asset.photo_added"
  | "document.indexed"
  | "integration.connected"
  | "integration.synced"
  | "copilot.answered"
  | "candidate.matched"
  | "workorder.closed"
  | "pm.suggested"
  | "pm.approved"
  | "pm.completed"
  | "pm.archived"
  | "part.created"
  | "part.updated"
  | "part.alias_added"
  | "part.linked"
  | "part.failed"
  | "part.supplier_added";

// Write an actor-attributed row to the audit log. Use this from API handlers so
// the log records WHO did WHAT (the system-level `emitEvent` uses actor=system).
//
// orgId is REQUIRED and is the tenant boundary: an audit row always belongs to
// exactly one organization. There is no shared/default fallback — callers must
// supply the org from the authenticated request context.
export async function audit(
  orgId: string,
  actor: string,
  action: string,
  target: string | null,
  detail?: unknown
): Promise<void> {
  if (!orgId) throw new Error("audit() requires orgId");
  await ensureDb();
  await db.insert(auditLog).values({
    id: id("aud"),
    orgId,
    actor: actor || "system",
    action,
    target: target ?? null,
    detail:
      detail === undefined
        ? null
        : typeof detail === "object"
          ? JSON.stringify(detail).slice(0, 1000)
          : String(detail),
  });
}

// Emit a domain event: persist to the outbox and fan out to subscribed
// webhooks with an HMAC signature. Delivery is fire-and-forget (best-effort)
// for the MVP; a production build moves this to a durable queue with retries.
//
// orgId is REQUIRED: events are tenant-scoped both in the outbox and in the
// webhook fan-out (only THIS org's webhooks ever see the event).
export async function emitEvent(
  orgId: string,
  type: EventType,
  payload: unknown
): Promise<void> {
  if (!orgId) throw new Error("emitEvent() requires orgId");
  await ensureDb();
  const evt = {
    id: id("evt"),
    orgId,
    type,
    payload: JSON.stringify(payload ?? {}),
    createdAt: new Date(),
  };
  await db.insert(events).values(evt);
  await db.insert(auditLog).values({
    id: id("aud"),
    orgId,
    actor: "system",
    action: `event.${type}`,
    target: null,
    detail: typeof payload === "object" ? JSON.stringify(payload).slice(0, 500) : String(payload),
  });

  // Deliver to webhooks (don't block the caller on network).
  void deliver(orgId, type, evt.id, payload);
}

async function deliver(orgId: string, type: string, eventId: string, payload: unknown) {
  try {
    const hooks = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.orgId, orgId), eq(webhooks.active, true)));

    const body = JSON.stringify({ id: eventId, type, data: payload, ts: Date.now() });

    await Promise.all(
      hooks
        .filter((h) => h.events === "*" || h.events.split(",").map((s) => s.trim()).includes(type))
        .map(async (h) => {
          const signature = createHmac("sha256", h.secret).update(body).digest("hex");
          try {
            await fetch(h.url, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-eas-event": type,
                "x-eas-signature": `sha256=${signature}`,
              },
              body,
              signal: AbortSignal.timeout(5000),
            });
          } catch {
            /* best-effort; production queue would retry + dead-letter */
          }
        })
    );
  } catch {
    /* swallow */
  }
}
