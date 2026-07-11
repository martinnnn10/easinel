import { describe, it, expect } from "vitest";
import { classifyAssetClass, classifyFailureType, rcaBoardState } from "./classify";

describe("classifyAssetClass", () => {
  it("classes machines from their name/model", () => {
    expect(classifyAssetClass({ name: "Line 2 Wrapper" })).toBe("Wrapper");
    expect(classifyAssetClass({ name: "Case Packer #3" })).toBe("Case Packer");
    expect(classifyAssetClass({ name: "Palletizer" })).toBe("Palletizer");
    expect(classifyAssetClass({ name: "Spiral Proofer" })).toBe("Oven");
    expect(classifyAssetClass({ name: "Dough Mixer 1" })).toBe("Mixer");
    expect(classifyAssetClass({ name: "VFD-CONV3", model: "PowerFlex 525" })).toBe("VFD");
    expect(classifyAssetClass({ name: "Discharge photoeye" })).toBe("Sensor");
  });
  it("falls back to asset_type, then Other", () => {
    expect(classifyAssetClass({ name: "Unit 9", assetType: "conveyor" })).toBe("Conveyor");
    expect(classifyAssetClass({ name: "Unit 9", assetType: "drive" })).toBe("VFD");
    expect(classifyAssetClass({ name: "Widget", assetType: "other" })).toBe("Other");
    expect(classifyAssetClass({ name: "Widget" })).toBe("Other");
  });
});

describe("classifyFailureType", () => {
  it("infers the discipline from the work order words", () => {
    expect(classifyFailureType("im not getting 24VDC")).toBe("Electrical");
    expect(classifyFailureType("VFD overcurrent fault on startup")).toBe("Electrical");
    expect(classifyFailureType("bearing failure, vibration and noise")).toBe("Mechanical");
    expect(classifyFailureType("photoeye keeps missing product")).toBe("Instrumentation / Sensor");
    expect(classifyFailureType("PLC comms fault, ethernet dropped")).toBe("Controls / PLC");
    expect(classifyFailureType("air cylinder won't extend, solenoid")).toBe("Pneumatic");
    expect(classifyFailureType("hydraulic ram pressure low")).toBe("Hydraulic");
  });
  it("returns Unknown when it can't tell", () => {
    expect(classifyFailureType("something is weird")).toBe("Unknown");
    expect(classifyFailureType("")).toBe("Unknown");
    expect(classifyFailureType(null)).toBe("Unknown");
  });
});

describe("rcaBoardState", () => {
  it("an existing RCA status wins", () => {
    expect(rcaBoardState("manager_confirmed", "corrective", 60)).toBe("manager_confirmed");
    expect(rcaBoardState("technician_completed", "corrective", 0)).toBe("technician_completed");
    expect(rcaBoardState("draft", "corrective", 60)).toBe("draft");
  });
  it("a corrective failure with downtime and no RCA needs one", () => {
    expect(rcaBoardState(undefined, "corrective", 45)).toBe("needed");
  });
  it("shows nothing for non-corrective or no-downtime work orders", () => {
    expect(rcaBoardState(undefined, "preventive", 45)).toBeNull();
    expect(rcaBoardState(undefined, "corrective", 0)).toBeNull();
    expect(rcaBoardState(undefined, "corrective", null)).toBeNull();
  });
});
