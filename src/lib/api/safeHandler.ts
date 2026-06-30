// ─────────────────────────────────────────────────────────────────────────
// safeHandler — a thin wrapper that guarantees an API route NEVER leaks an
// unhandled exception as an opaque, uncorrelated 500.
//
// Without it, a throw inside a route handler produces a bare 500 with no body,
// no log line, and no way to tie a customer's "it broke at 2:47pm" to anything.
// With it, every uncaught error becomes:
//   • a structured server log (route name + request id + the error), and
//   • a clean JSON envelope { error, message, requestId } the client can show
//     and a support engineer can grep for — with NO stack trace leaked to the
//     caller.
//
// It is generic over the handler's trailing args, so it wraps both plain routes
// `(req)` and dynamic routes `(req, { params })` unchanged. Permission gates and
// normal responses pass straight through; only thrown errors are intercepted.
// ─────────────────────────────────────────────────────────────────────────

import type { NextRequest } from "next/server";
import { apiError, requestIdFrom } from "./respond";
import { logger } from "@/lib/observability/logger";

export function safeHandler<A extends unknown[]>(
  name: string,
  fn: (req: NextRequest, ...args: A) => Promise<Response>
): (req: NextRequest, ...args: A) => Promise<Response> {
  return async (req: NextRequest, ...args: A): Promise<Response> => {
    const requestId = requestIdFrom(req);
    try {
      return await fn(req, ...args);
    } catch (err) {
      logger.error("route.unhandled_error", {
        route: name,
        method: req.method,
        requestId,
        error: err,
      });
      return apiError("internal_error", {
        status: 500,
        requestId,
        message: "An unexpected error occurred. Please try again — if it persists, contact support with the reference id.",
      });
    }
  };
}
