import type {
  ConnectorAdapter,
  ExternalAsset,
  ExternalWorkOrder,
  PushWorkOrderInput,
  PushResult,
} from "../adapter";
import type { ConnectorDef } from "../registry";

// Live MaintainX adapter. Activates automatically when MAINTAINX_API_KEY is set;
// otherwise the sandbox adapter is used. MaintainX REST API v1:
//   https://api.getmaintainx.com/v1   (Bearer auth)
//
// Field mapping is intentionally defensive — MaintainX response shapes have
// varied across API versions, so we read both common envelopes.

const BASE = process.env.MAINTAINX_BASE_URL ?? "https://api.getmaintainx.com/v1";

function priorityToMx(p: string): string {
  switch (p) {
    case "urgent":
    case "high":
      return "HIGH";
    case "low":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
function priorityFromMx(p?: string): string {
  switch ((p ?? "").toUpperCase()) {
    case "HIGH":
      return "high";
    case "LOW":
      return "low";
    case "NONE":
      return "low";
    default:
      return "medium";
  }
}
function statusFromMx(s?: string): string {
  const v = (s ?? "").toUpperCase();
  if (v.includes("DONE") || v.includes("COMPLETE")) return "done";
  if (v.includes("PROGRESS")) return "in_progress";
  if (v.includes("HOLD")) return "on_hold";
  return "open";
}

export function maintainxAdapter(def: ConnectorDef, apiKey: string): ConnectorAdapter {
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  async function call(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      throw new Error(
        `MaintainX ${res.status}: ${
          (json as { message?: string })?.message ?? text.slice(0, 160)
        }`
      );
    }
    return json;
  }

  // Walk cursor-paginated list endpoints so a real plant's full history is
  // imported, not just the first page. Reads both the common list envelopes and
  // both common next-cursor field names; capped to avoid runaway pulls.
  async function paginate(path: string, listKey: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40; page++) {
      const q = new URLSearchParams({ pageSize: "100" });
      if (cursor) q.set("cursor", cursor);
      const data = (await call(`${path}?${q.toString()}`)) as Record<string, unknown>;
      const rows = ((data?.[listKey] as unknown[]) ?? (data?.data as unknown[]) ?? []) as Record<string, unknown>[];
      out.push(...rows);
      const next = (data?.nextCursor ?? data?.nextPageToken ?? (data?.meta as { nextCursor?: string })?.nextCursor) as string | undefined;
      if (!next || rows.length === 0) break;
      cursor = next;
    }
    return out;
  }

  return {
    def,
    async testConnection() {
      try {
        await call("/workorders?pageSize=1");
        return { ok: true, detail: "Connected to MaintainX (live)." };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
    async pullAssets(): Promise<ExternalAsset[]> {
      const rows = await paginate("/assets", "assets");
      return rows.map((a) => ({
        externalId: String(a.id ?? a.assetId ?? ""),
        name: String(a.name ?? a.title ?? "Asset"),
        area: a.location ? String((a.location as { name?: string })?.name ?? "") : undefined,
      }));
    },
    async pullWorkOrders(): Promise<ExternalWorkOrder[]> {
      const rows = await paginate("/workorders", "workOrders");
      return rows.map((w) => ({
        externalId: String(w.id ?? ""),
        title: String(w.title ?? w.name ?? "Work order"),
        status: statusFromMx(w.status as string),
        priority: priorityFromMx(w.priority as string),
        assetExternalId: w.assetId ? String(w.assetId) : undefined,
      }));
    },
    async pushWorkOrder(input: PushWorkOrderInput): Promise<PushResult> {
      const body = {
        title: input.title,
        description: input.description ?? "",
        priority: priorityToMx(input.priority),
      };
      const created = (await call("/workorders", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { id?: string | number; workOrder?: { id?: string | number } };
      const externalId = String(created?.id ?? created?.workOrder?.id ?? "");
      return {
        externalId,
        externalSystem: def.name,
        url: externalId ? `https://app.getmaintainx.com/workorders/${externalId}` : undefined,
      };
    },
  };
}
