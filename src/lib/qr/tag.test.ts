import { describe, it, expect } from "vitest";
import { assetTagUrl, qrSvg } from "./tag";

describe("assetTagUrl", () => {
  it("builds the /field deep link and trims a trailing slash on the base", () => {
    expect(assetTagUrl("https://easmaint.com", "ast_1")).toBe("https://easmaint.com/field?asset=ast_1");
    expect(assetTagUrl("https://easmaint.com/", "ast_1")).toBe("https://easmaint.com/field?asset=ast_1");
  });
  it("url-encodes the asset id", () => {
    expect(assetTagUrl("https://x.io", "ast/1 2")).toBe("https://x.io/field?asset=ast%2F1%202");
  });
});

describe("qrSvg", () => {
  it("renders a self-contained SVG with a white quiet zone and dark modules", () => {
    const svg = qrSvg("https://easmaint.com/field?asset=ast_1");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#ffffff"'); // quiet zone / background
    expect(svg).toContain('fill="#000000"'); // module path
    expect(svg).toContain("<path d=\"M"); // at least one dark module drawn
    // Fully self-contained — no external references that a strict CSP would block.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("is deterministic for the same input", () => {
    const a = qrSvg("ast_stable");
    const b = qrSvg("ast_stable");
    expect(a).toBe(b);
  });

  it("grows the module grid for longer data (auto version)", () => {
    const short = qrSvg("a");
    const long = qrSvg("https://easmaint.com/field?asset=" + "x".repeat(120));
    const viewBox = (s: string) => Number(s.match(/viewBox="0 0 (\d+)/)![1]);
    expect(viewBox(long)).toBeGreaterThan(viewBox(short));
  });

  it("honors a custom pixel size while keeping the module viewBox", () => {
    const svg = qrSvg("ast_1", { size: 240 });
    expect(svg).toContain('width="240" height="240"');
  });

  it("rejects empty text", () => {
    expect(() => qrSvg("")).toThrow();
  });
});
