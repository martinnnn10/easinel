import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  rateLimitHeaders,
  clientIp,
  __resetRateLimit,
} from "./rateLimit";

const RULE = { limit: 3, windowMs: 1000 };

describe("checkRateLimit (fixed-window)", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit, then blocks within the window", () => {
    const t0 = 1_000_000;
    expect(checkRateLimit("b", "ip1", RULE, t0).ok).toBe(true); // 1
    expect(checkRateLimit("b", "ip1", RULE, t0).ok).toBe(true); // 2
    const third = checkRateLimit("b", "ip1", RULE, t0);
    expect(third.ok).toBe(true); // 3
    expect(third.remaining).toBe(0);
    const fourth = checkRateLimit("b", "ip1", RULE, t0);
    expect(fourth.ok).toBe(false); // 4 → blocked
    expect(fourth.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("resets after the window elapses", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("b", "ip2", RULE, t0);
    expect(checkRateLimit("b", "ip2", RULE, t0).ok).toBe(false);
    // Past the window → fresh allowance.
    expect(checkRateLimit("b", "ip2", RULE, t0 + 1001).ok).toBe(true);
  });

  it("isolates clients and buckets from each other", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("b", "ipA", RULE, t0);
    expect(checkRateLimit("b", "ipA", RULE, t0).ok).toBe(false); // A exhausted
    expect(checkRateLimit("b", "ipB", RULE, t0).ok).toBe(true); // B untouched
    expect(checkRateLimit("other", "ipA", RULE, t0).ok).toBe(true); // other bucket untouched
  });

  it("emits RFC-style headers and a Retry-After only when blocked", () => {
    const t0 = 4_000_000;
    const ok = checkRateLimit("b", "ipH", RULE, t0);
    const okH = rateLimitHeaders(ok);
    expect(okH["X-RateLimit-Limit"]).toBe("3");
    expect(okH["Retry-After"]).toBeUndefined();
    for (let i = 0; i < 3; i++) checkRateLimit("b", "ipH", RULE, t0);
    const blocked = checkRateLimit("b", "ipH", RULE, t0);
    expect(rateLimitHeaders(blocked)["Retry-After"]).toBeDefined();
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const req = { headers: new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) };
    expect(clientIp(req)).toBe("203.0.113.7");
  });
  it("falls back through x-real-ip then a constant", () => {
    expect(clientIp({ headers: new Headers({ "x-real-ip": "198.51.100.2" }) })).toBe("198.51.100.2");
    expect(clientIp({ headers: new Headers() })).toBe("unknown");
  });
});
