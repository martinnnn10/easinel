import { describe, it, expect } from "vitest";
import { COPILOT_SYSTEM_PROMPT as P } from "./systemPrompt";

// Fix 1 — Copilot prompt safety hardening. These assert the trust-and-safety
// contract the audit required, so a future prompt edit can't silently drop it.

describe("Copilot system prompt safety contract", () => {
  it("forbids fabricating terminal/wire numbers, PLC tags, and register addresses", () => {
    expect(P).toMatch(/do not fabricate[^.]*terminal or wire numbers[^.]*PLC tags\/register addresses/i);
    expect(P).toMatch(/PLC tag, or register address/i);
  });

  it("requires functional description unless a real drawing/export names the designation", () => {
    expect(P).toMatch(/ONLY when it appears in an uploaded drawing\/manual\/PLC export/i);
    expect(P).toMatch(/confirm the exact terminal numbers on the wiring diagram/i);
  });

  it("restores NFPA 70E qualified-person language for energized work", () => {
    expect(P).toMatch(/NFPA 70E/);
    expect(P).toMatch(/QUALIFIED-PERSON work/i);
  });

  it("does not weaken LOTO and separates energized diagnostics from repair", () => {
    expect(P).toMatch(/ALWAYS say LOTO when the technician is about to touch a conductor/i);
    expect(P).toMatch(/de-energized repair steps/i);
    expect(P).toMatch(/energized diagnostic steps/i);
  });

  it("tells the model to confirm an unknown equipment model rather than assume one", () => {
    expect(P).toMatch(/Never assume or assert a specific equipment model/i);
    expect(P).toMatch(/confirm the exact model on the nameplate\/manual/i);
  });

  it("does not hardcode a specific drive model as the user's asset in the confidence example", () => {
    // The domains-mastered catalog may list PowerFlex models as general knowledge,
    // but the answer template must not assert the user's machine IS a PowerFlex 525.
    expect(P).not.toMatch(/Would be High if the PowerFlex 525 user manual were uploaded/);
  });
});
