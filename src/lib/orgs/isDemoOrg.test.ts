import { describe, it, expect } from "vitest";
import { isDemoOrg, shouldShowDemoBanner, DEMO_ORG_ID, DEMO_ORG_NAME } from "./isDemoOrg";

const REAL = { id: "org_32458f29-29a6-4de2-b609-9880bcab4e6f", name: "Acme Foods" };

describe("isDemoOrg", () => {
  it("is true for the demo org by id", () => {
    expect(isDemoOrg({ id: DEMO_ORG_ID, name: "Renamed Later" })).toBe(true);
  });
  it("is true for the demo org by name (re-created case)", () => {
    expect(isDemoOrg({ id: "org_new", name: DEMO_ORG_NAME })).toBe(true);
  });
  // Fix 9: alignment with the platform's reserved Demo Organization tenant —
  // demo labels must fire for the reserved org too, not only the legacy UUID.
  it("is true for the reserved Demo Organization by id (org_demo)", () => {
    expect(isDemoOrg({ id: "org_demo", name: "Renamed Demo" })).toBe(true);
  });
  it("is true for the reserved Demo Organization by name", () => {
    expect(isDemoOrg({ id: "org_whatever", name: "Demo Organization" })).toBe(true);
  });
  it("is false for a real customer org", () => {
    expect(isDemoOrg(REAL)).toBe(false);
  });
  it("is false for a customer org that merely contains 'demo' loosely", () => {
    expect(isDemoOrg({ id: "org_real", name: "Demolition Supply Co" })).toBe(false);
  });
  it("is false for null/undefined/empty", () => {
    expect(isDemoOrg(null)).toBe(false);
    expect(isDemoOrg(undefined)).toBe(false);
    expect(isDemoOrg({})).toBe(false);
  });
  it("does not match on a near-miss name", () => {
    expect(isDemoOrg({ id: "x", name: "EAS Demo Plant 2" })).toBe(false);
    expect(isDemoOrg({ id: "x", name: "eas demo plant" })).toBe(false); // case-sensitive on purpose
  });
});

describe("shouldShowDemoBanner", () => {
  it("shows on in-app routes for the demo org", () => {
    for (const p of ["/today", "/reliability", "/impact", "/roi", "/pm", "/work-orders", "/copilot"]) {
      expect(shouldShowDemoBanner({ id: DEMO_ORG_ID }, p)).toBe(true);
    }
  });
  it("never shows on the public homepage or auth/field routes, even for the demo org", () => {
    for (const p of ["/", "/privacy", "/terms", "/login", "/login/forgot", "/field", "/field/abc"]) {
      expect(shouldShowDemoBanner({ id: DEMO_ORG_ID }, p)).toBe(false);
    }
  });
  it("never shows for a real customer org, on any route", () => {
    for (const p of ["/today", "/reliability", "/impact", "/roi"]) {
      expect(shouldShowDemoBanner(REAL, p)).toBe(false);
    }
  });
  it("never shows when there is no org", () => {
    expect(shouldShowDemoBanner(null, "/today")).toBe(false);
  });
});
