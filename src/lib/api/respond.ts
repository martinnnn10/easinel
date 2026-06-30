// ─────────────────────────────────────────────────────────────────────────
// Consistent JSON API envelope + request correlation.
//
// Every hardened endpoint returns the SAME error shape and carries an
// `x-request-id` header so a client error report (or a log line) can be tied
// back to the exact request that produced it. This is the contract enterprise
// API consumers and support teams rely on:
//
//   error:   { error: <machine code>, message: <human text>, requestId }
//   success: <payload>           (+ x-request-id header)
//
// Helpers are additive — existing routes keep working unchanged; new and
// security-sensitive routes adopt these for a uniform, debuggable surface.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

const REQUEST_ID_HEADER = "x-request-id";

// Resolve a stable request id: honor an inbound id from a gateway/proxy (so a
// trace spans services) or mint a fresh one.
export function requestIdFrom(req: { headers: Headers }): string {
  const inbound = req.headers.get(REQUEST_ID_HEADER);
  if (inbound && /^[\w.\-]{8,128}$/.test(inbound)) return inbound;
  return `req_${randomUUID()}`;
}

function withId<T>(res: NextResponse<T>, requestId: string): NextResponse<T> {
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export interface ApiErrorOptions {
  status?: number;
  message?: string;
  requestId?: string;
  /** Extra headers (e.g. Retry-After on a 429). */
  headers?: Record<string, string>;
}

// A machine-readable error code + human message, with the request id echoed in
// both body and header.
export function apiError(code: string, opts: ApiErrorOptions = {}): NextResponse {
  const requestId = opts.requestId ?? `req_${randomUUID()}`;
  const res = NextResponse.json(
    { error: code, message: opts.message ?? code, requestId },
    { status: opts.status ?? 400 }
  );
  for (const [k, v] of Object.entries(opts.headers ?? {})) res.headers.set(k, v);
  return withId(res, requestId);
}

export function apiOk<T>(payload: T, opts: { status?: number; requestId?: string } = {}): NextResponse {
  const requestId = opts.requestId ?? `req_${randomUUID()}`;
  return withId(NextResponse.json(payload, { status: opts.status ?? 200 }), requestId);
}
