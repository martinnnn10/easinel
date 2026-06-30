// ─────────────────────────────────────────────────────────────────────────
// Request-body validation — one place to turn an untrusted JSON payload into a
// typed, known-good value or a clean 400.
//
// Enterprise APIs must reject malformed input deterministically rather than let
// it flow into the data layer and surface later as a confusing 500 or, worse,
// bad rows. `parseBody` reads the JSON body, validates it against a Zod schema,
// and returns EITHER the typed data OR a ready-to-send 400 envelope that lists
// exactly which fields failed and why — with the request id for correlation.
//
//   const parsed = await parseBody(req, CreateWorkOrder);
//   if (parsed.response) return parsed.response;
//   const { title, priority } = parsed.data;   // fully typed + validated
//
// Pairs with safeHandler: validation handles EXPECTED bad input (400); the
// wrapper handles UNEXPECTED faults (500). Together every route has a defined
// response for both.
// ─────────────────────────────────────────────────────────────────────────

import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requestIdFrom } from "./respond";

export type ParseResult<T> =
  | { data: T; response?: undefined }
  | { data?: undefined; response: ReturnType<typeof apiError> };

export async function parseBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>
): Promise<ParseResult<T>> {
  const requestId = requestIdFrom(req);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      response: apiError("invalid_json", {
        status: 400,
        requestId,
        message: "Request body must be valid JSON.",
      }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    // Compact, caller-friendly field errors: "field: message".
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
      .slice(0, 12);
    return {
      response: apiError("validation_failed", {
        status: 400,
        requestId,
        message: `Invalid request: ${issues.join("; ")}`,
      }),
    };
  }

  return { data: result.data };
}

// Small shared field schemas so routes stay consistent (trimmed non-empty
// strings, the canonical enums, etc.).
export const NonEmpty = z.string().trim().min(1);
export const OptStr = z.string().trim().optional().nullable();
export const Priority = z.enum(["low", "medium", "high", "urgent"]);
export const WoType = z.enum(["corrective", "preventive", "inspection"]);
