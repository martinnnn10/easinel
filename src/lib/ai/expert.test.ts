import { describe, it, expect } from "vitest";
import { parseFaultEntries, detectFaultQuery, buildFaultCodeAnswer } from "./expert";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

const pfRef: RetrievedChunk = {
  id: "c1",
  documentId: "d1",
  filename: "Allen-Bradley PowerFlex 525 — Common Fault Reference (General).md",
  kind: "oem_reference",
  ordinal: 0,
  score: 1,
  content: `COMMON FAULT CODES
F004 UnderVoltage — DC bus below limit. Check incoming supply, voltage sags, loose input wiring.
F005 OverVoltage — DC bus too high. Usually a too-fast decel ramp; lengthen decel time.
F007 Motor Overload — drive I2t thermal model exceeded. Mechanical drag, undersized accel time.
F081 Comm Loss — drive lost its network control connection. Check the cable, switch port, IP config.`,
};

describe("expert fault-code answers (answer first, cite second)", () => {
  it("parses fault entries from an OEM reference chunk", () => {
    const entries = parseFaultEntries([pfRef]);
    const f004 = entries.find((e) => e.code === "F004");
    expect(f004).toBeTruthy();
    expect(f004!.name).toMatch(/undervoltage/i);
    expect(f004!.meaning.toLowerCase()).toContain("dc bus below limit");
    expect(f004!.checks.toLowerCase()).toContain("incoming supply");
    expect(f004!.marker).toBe(1);
  });

  it("detects a symptom question (undervoltage → code lookup)", () => {
    const q = detectFaultQuery("what code is under voltage for a powerflex drive?");
    expect(q?.kind).toBe("symptom");
  });

  it("detects a direct code question (F004)", () => {
    const q = detectFaultQuery("what does fault F004 mean?");
    expect(q?.kind).toBe("code");
    expect(q?.code).toBe("F004");
  });

  it("answers the undervoltage question DIRECTLY with F004", () => {
    const a = buildFaultCodeAnswer("what code is under voltage for a PowerFlex drive?", [pfRef]);
    expect(a).toContain("## Answer");
    expect(a).toMatch(/F004/);
    expect(a).toMatch(/undervoltage/i);
    // Direct answer must come BEFORE the sources section.
    expect(a.indexOf("## Answer")).toBeLessThan(a.indexOf("## Sources Used"));
    // Expert structure present.
    expect(a).toContain("## What It Means");
    expect(a).toContain("## What To Check First");
    expect(a).toContain("## Safety");
    expect(a).toContain("## When To Create a Work Order");
    // Must NOT be a passage dump.
    expect(a).not.toContain("What Your Documents Say");
  });

  it("answers a direct code lookup (F081 → Comm Loss)", () => {
    const a = buildFaultCodeAnswer("what is F081?", [pfRef]);
    expect(a).toMatch(/F081/);
    expect(a.toLowerCase()).toMatch(/comm/);
  });

  it("returns empty for a non-fault-code question (defers to other paths)", () => {
    expect(buildFaultCodeAnswer("how do I align a pump coupling?", [pfRef])).toBe("");
  });
});
