// Lightweight, honest classification for the Today command board. Both helpers
// are heuristic and conservative: when nothing matches confidently they return
// a neutral value ("Other" / "Unknown") rather than guessing — the user can set
// the real class/type on the asset or work order later. No taxonomy explosion.

export interface AssetClassInput {
  name?: string | null;
  model?: string | null;
  assetType?: string | null;
}

// A short, human display "class" for a machine — derived from its own fields.
// Name/model win (most specific); assetType is the fallback signal.
const ASSET_CLASS_RULES: { label: string; re: RegExp }[] = [
  { label: "Case Packer", re: /case[\s-]?pack|caser|case erector/i },
  { label: "Palletizer", re: /palletiz|palletis/i },
  { label: "Wrapper", re: /wrapp|shrink|flow ?wrap|overwrap/i },
  { label: "Depositor", re: /deposit|filler|filling/i },
  { label: "Conveyor", re: /conveyor|belt|infeed|discharge belt/i },
  { label: "Mixer", re: /mixer|blender|agitator|kneader/i },
  { label: "Oven", re: /oven|proofer|prover|furnace|kiln|dryer/i },
  { label: "VFD", re: /vfd|powerflex|drive\b|inverter/i },
  { label: "PLC / I/O", re: /\bplc\b|controllogix|compactlogix|\bi\/?o\b|hmi/i },
  { label: "Sensor", re: /sensor|photoeye|photo-?eye|proximity|encoder|transmitter/i },
  { label: "Pump", re: /pump/i },
  { label: "Motor", re: /motor|gearmotor/i },
  { label: "Pneumatic", re: /pneumatic|air cylinder|solenoid valve/i },
  { label: "Hydraulic", re: /hydraulic|\bhpu\b/i },
  { label: "Utility", re: /compressor|chiller|boiler|hvac|utility/i },
];
// Map the coarse asset_type enum to a display class as a last resort.
const TYPE_MAP: Record<string, string> = {
  conveyor: "Conveyor", drive: "VFD", robot: "Robot", pump: "Pump", press: "Press",
  packaging: "Packaging", hvac: "Utility", motor: "Motor",
};

export function classifyAssetClass(a: AssetClassInput): string {
  const hay = `${a.name ?? ""} ${a.model ?? ""}`;
  for (const r of ASSET_CLASS_RULES) if (r.re.test(hay)) return r.label;
  const t = (a.assetType ?? "").toLowerCase().trim();
  if (t && TYPE_MAP[t]) return TYPE_MAP[t];
  if (t && t !== "other") return t.charAt(0).toUpperCase() + t.slice(1);
  return "Other";
}

export type FailureType =
  | "Electrical" | "Mechanical" | "Controls / PLC" | "Instrumentation / Sensor"
  | "Pneumatic" | "Hydraulic" | "Utilities" | "Process" | "Unknown";

// Infer the failure discipline from the work order's own words (symptom, title,
// failed part, root cause). Ordered most-specific first. "Unknown" when unsure.
const FAILURE_RULES: { type: FailureType; re: RegExp }[] = [
  { type: "Instrumentation / Sensor", re: /photoeye|photo-?eye|proximity|sensor|encoder|transmitter|thermocouple|rtd|load ?cell|calibrat/i },
  { type: "Controls / PLC", re: /\bplc\b|hmi|program|logic|ladder|comms?|ethernet|profibus|fault code|\bf0\d\d\b|alarm code|scada/i },
  { type: "Pneumatic", re: /pneumatic|\bair\b|cylinder|solenoid|regulator|fpm air|air pressure/i },
  { type: "Hydraulic", re: /hydraulic|\bhpu\b|oil pressure|ram\b/i },
  { type: "Electrical", re: /24\s?vdc|\bvdc\b|\bvac\b|voltage|contactor|breaker|fuse|overload|short|ground fault|wiring|terminal|no power|drive fault|overcurrent|vfd|power supply/i },
  { type: "Utilities", re: /steam|water|compressed air|chiller|boiler|hvac|utility|glycol/i },
  { type: "Process", re: /product|recipe|setpoint|quality|reject|jam|backup|out of spec|temperature drift/i },
  { type: "Mechanical", re: /bearing|belt|chain|coupling|gearbox|seal|gasket|shaft|sprocket|alignment|worn|vibration|leak|broken|loose|hose/i },
];

export function classifyFailureType(text: string | null | undefined): FailureType {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return "Unknown";
  for (const r of FAILURE_RULES) if (r.re.test(t)) return r.type;
  return "Unknown";
}

export type RcaBoardState = "needed" | "draft" | "technician_completed" | "manager_confirmed" | null;

// The RCA badge state to show for a work order on the board. An existing RCA's
// status wins; otherwise a corrective failure with real downtime and no RCA yet
// "needs" one. Non-corrective or no-downtime work orders show nothing.
export function rcaBoardState(
  existing: "draft" | "technician_completed" | "manager_confirmed" | undefined,
  woType: string,
  downtimeMins: number | null | undefined
): RcaBoardState {
  if (existing) return existing;
  if (woType === "corrective" && downtimeMins != null && downtimeMins > 0) return "needed";
  return null;
}
