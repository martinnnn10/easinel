import { describe, it, expect } from "vitest";
import { coarseCategory } from "./coarseCategory";

// Fix 8 — the /health endpoint is UNAUTHENTICATED. It must never echo raw
// provider/DB error text (which can leak keys, DATABASE_URL, env paths, stack
// traces). coarseCategory() reduces any error string to a safe bucket.

describe("health coarseCategory (unauthenticated redaction)", () => {
  it("maps auth failures to 'auth'", () => {
    expect(coarseCategory("401 Unauthorized: invalid x-api-key sk-ant-abc123")).toBe("auth");
    expect(coarseCategory("Incorrect API key provided")).toBe("auth");
    expect(coarseCategory("403 Forbidden")).toBe("auth");
  });

  it("maps quota/rate errors to 'rate_limit'", () => {
    expect(coarseCategory("429 Too Many Requests")).toBe("rate_limit");
    expect(coarseCategory("You exceeded your current quota")).toBe("rate_limit");
  });

  it("maps network/upstream errors to 'upstream'", () => {
    expect(coarseCategory("ETIMEDOUT connecting to api.anthropic.com")).toBe("upstream");
    expect(coarseCategory("fetch failed")).toBe("upstream");
    expect(coarseCategory("502 Bad Gateway")).toBe("upstream");
  });

  it("falls back to 'down' for anything else, and null for no error", () => {
    expect(coarseCategory("some other opaque failure")).toBe("down");
    expect(coarseCategory(null)).toBe(null);
    expect(coarseCategory(undefined)).toBe(null);
    expect(coarseCategory("")).toBe(null);
  });

  it("never returns the raw error text (only a coarse bucket)", () => {
    const raw = "connect ECONNREFUSED 10.0.0.5:5432 DATABASE_URL=libsql://secret-token@host";
    const cat = coarseCategory(raw);
    expect(["auth", "rate_limit", "upstream", "down", null]).toContain(cat);
    expect(cat).not.toContain("DATABASE_URL");
    expect(cat).not.toContain("secret-token");
  });
});
