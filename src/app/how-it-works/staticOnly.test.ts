import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Trust guarantee: the How It Works page is teaching content only. It must never
// read from or write to the org database, and must never fetch org data — so a
// buyer walkthrough can never pollute the real workspace with example data.
const src = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

describe("how-it-works page is static teaching content", () => {
  it("does not import the database or any repository", () => {
    expect(src).not.toMatch(/@\/lib\/db/);
    expect(src).not.toMatch(/from ["']@\/lib\/[^"']*repository/);
  });
  it("performs no writes or network calls", () => {
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.execute\(/);
    expect(src).not.toMatch(/\bfetch\(/);
  });
  it("labels the worked example as sample-only", () => {
    expect(src).toMatch(/Example only — not your plant data/);
  });
});
