import { describe, it, expect } from "vitest";
import { resolveSafeNext } from "./safeRedirect";

const ORIGIN = "https://app.easmaint.com";

describe("resolveSafeNext — open-redirect defense", () => {
  it("keeps legitimate same-origin paths (incl. query used by deep links)", () => {
    expect(resolveSafeNext("/today", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("/copilot?asset=ast_1&ask=F007%20overload", ORIGIN)).toBe("/copilot?asset=ast_1&ask=F007%20overload");
    expect(resolveSafeNext("/work-orders/wo_9#notes", ORIGIN)).toBe("/work-orders/wo_9#notes");
  });

  it("rejects protocol-relative and backslash-normalized cross-origin targets", () => {
    // The exact bypass the reviewer found: "/\evil.com" normalizes to //evil.com.
    expect(resolveSafeNext("/\\evil.com", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("//evil.com", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("\\/evil.com", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("/\\\\evil.com", ORIGIN)).toBe("/today");
  });

  it("rejects absolute URLs to other origins", () => {
    expect(resolveSafeNext("https://evil.com", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("http://evil.com/phish", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("javascript:alert(1)", ORIGIN)).toBe("/today");
  });

  it("falls back to /today on empty/blank/malformed", () => {
    expect(resolveSafeNext(null, ORIGIN)).toBe("/today");
    expect(resolveSafeNext("", ORIGIN)).toBe("/today");
    expect(resolveSafeNext("   ", ORIGIN)).toBe("/today");
  });
});
