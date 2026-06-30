// Route-level rate-limit enforcement. Returns a ready-to-send 429 NextResponse
// when the client is over the limit, or null to proceed. Keeps handlers to a
// single guard line:
//
//   const limited = enforceRateLimit(req, "auth:login", RATE_RULES.auth());
//   if (limited) return limited;
//
import type { NextResponse } from "next/server";
import { apiError, requestIdFrom } from "@/lib/api/respond";
import {
  checkRateLimit,
  rateLimitHeaders,
  clientIp,
  type RateLimitRule,
} from "./rateLimit";
import { logger } from "@/lib/observability/logger";

export function enforceRateLimit(
  req: { headers: Headers },
  bucket: string,
  rule: RateLimitRule
): NextResponse | null {
  const client = clientIp(req);
  const result = checkRateLimit(bucket, client, rule);
  if (result.ok) return null;

  const requestId = requestIdFrom(req);
  logger.warn("rate_limit.exceeded", { bucket, client, requestId, retryAfterSec: result.retryAfterSec });
  return apiError("rate_limited", {
    status: 429,
    message: "Too many requests. Please slow down and try again shortly.",
    requestId,
    headers: rateLimitHeaders(result),
  });
}
