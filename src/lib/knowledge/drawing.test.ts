import { describe, it, expect } from "vitest";
import { extractDrawingInfo } from "./drawing";

const SAMPLE =
  "Conveyor 3 — Electrical / Power Drawing (Drawing No. E-CONV3-014, Rev C)\n" +
  "AREA: Packaging Line 2. MOTOR: 5 HP, 480 VAC, 3-phase, FLA 7.6 A, 1750 rpm.\n" +
  "GEARBOX: helical inline, 20:1. DRIVE: PowerFlex 525 (VFD-CONV3), EtherNet/IP.\n" +
  "POWER PATH\n" +
  " MCC-2 Bucket 7 -> 15 A breaker CB-CONV3 -> VFD-CONV3 (PowerFlex 525) -> MTR-CONV3.\n" +
  "CONTROL\n" +
  " Run/Stop from PLC (CompactLogix L24, rack PKG2) over EtherNet/IP.\n" +
  " E-stop string: gate guard GS-3 + pull-cord PC-3 -> safety relay -> drive STO (F059 if open).";

describe("extractDrawingInfo", () => {
  it("parses a realistic electrical drawing", () => {
    const info = extractDrawingInfo(SAMPLE);

    expect(info.drawingNumber).toBe("E-CONV3-014");
    expect(info.revision).toBe("C");
    expect(info.area).toMatch(/Packaging/i);
    expect(info.title).toBeTruthy();

    expect(info.equipmentTags).toContain("VFD-CONV3");
    expect(info.equipmentTags).toContain("MTR-CONV3");
    // The drawing number itself must not appear as an equipment tag.
    expect(info.equipmentTags).not.toContain("E-CONV3-014");

    expect(
      info.plcRefs.some((r) => /CompactLogix|EtherNet/i.test(r))
    ).toBe(true);

    expect(info.components).toContain("Safety relay");
    expect(info.components).toContain("E-stop");
  });

  it("surfaces panels and controllers honestly", () => {
    const info = extractDrawingInfo(SAMPLE);
    expect(info.panels.some((p) => /MCC-2/i.test(p))).toBe(true);
  });

  it("returns all-empty for empty text without throwing", () => {
    const info = extractDrawingInfo("");
    expect(info.drawingNumber).toBeNull();
    expect(info.revision).toBeNull();
    expect(info.title).toBeNull();
    expect(info.area).toBeNull();
    expect(info.equipmentTags).toEqual([]);
    expect(info.panels).toEqual([]);
    expect(info.plcRefs).toEqual([]);
    expect(info.wireNumbers).toEqual([]);
    expect(info.components).toEqual([]);
  });

  it("returns all-empty for garbage text without throwing", () => {
    const info = extractDrawingInfo("   \n\t   ~~~ ??? \n   ");
    expect(info.drawingNumber).toBeNull();
    expect(info.equipmentTags).toEqual([]);
    expect(info.components).toEqual([]);
    expect(info.plcRefs).toEqual([]);
  });
});
