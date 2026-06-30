import { describe, it, expect, afterEach } from "vitest";
import { securityHeaders, applySecurityHeaders } from "./headers";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("securityHeaders (OWASP baseline)", () => {
  it("always ships the core hardening headers", () => {
    const h = securityHeaders();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("allows the camera to self (QR/nameplate scan) but denies mic + geo", () => {
    const pp = securityHeaders()["Permissions-Policy"];
    expect(pp).toContain("camera=(self)");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });

  it("omits CSP unless explicitly enabled", () => {
    delete process.env.CSP_ENABLED;
    expect(securityHeaders()["Content-Security-Policy"]).toBeUndefined();
  });

  it("emits a framing-locked CSP when enabled", () => {
    process.env.CSP_ENABLED = "true";
    const csp = securityHeaders()["Content-Security-Policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("merges an extra connect-src origin from env into the CSP", () => {
    process.env.CSP_ENABLED = "true";
    process.env.CSP_CONNECT_SRC = "https://api.example.com";
    expect(securityHeaders()["Content-Security-Policy"]).toContain("https://api.example.com");
  });

  it("applies headers onto a Headers object in place", () => {
    const target = new Headers();
    applySecurityHeaders(target);
    expect(target.get("X-Frame-Options")).toBe("DENY");
  });
});
