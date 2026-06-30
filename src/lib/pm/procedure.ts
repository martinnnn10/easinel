// ─────────────────────────────────────────────────────────────────────────
// PM PROCEDURE QUALITY STANDARD
//
// This module is the single source of truth for HOW a generated PM task step is
// shaped and SEQUENCED. It exists to fix two problems with the earlier generator:
//
//   1. Unsafe sequencing — LOTO was unconditionally the FIRST step, ahead of
//      operational observations that must be taken while the machine is RUNNING.
//      That is unsafe-by-instruction (it tells a tech to take running readings on
//      a locked-out machine). The correct order is:
//          a. Operating-state observations (Running / Running under load)
//          b. A single, explicit LOTO TRANSITION step
//          c. Hands-on / contact work (Stopped / LOTO)
//      `sequenceTasks()` enforces this ordering deterministically, regardless of
//      the order tasks were authored or returned by an LLM.
//
//   2. Vague one-liners — each step now carries a full structured procedure
//      (purpose, operating state, PPE, tools, parts, step-by-step procedure,
//      measurements, acceptance criteria, out-of-spec action, est. time, skill
//      level, OEM refs, common failure modes). The detail view renders whatever
//      fields are present; legacy title-only tasks still render.
//
// Nothing here invents part numbers, prices, or plant failure history. Plant
// history is injected by the caller (generate.ts) from REAL work orders only.
// ─────────────────────────────────────────────────────────────────────────

export type OperatingState =
  | "Running"
  | "Running under load"
  | "Running unloaded"
  | "Stopped"
  | "LOTO";

// The rich, structured shape of a single PM task step. Every field except
// `title` and `operatingState` is optional so callers can emit partial steps and
// the UI degrades gracefully.
export interface PmTaskDetail {
  title: string;
  purpose?: string;
  operatingState: OperatingState;
  safety?: string[];
  ppe?: string[];
  tools?: string[];
  parts?: string[];
  procedure?: string[]; // ordered sub-steps
  measurements?: string[];
  acceptanceCriteria?: string[];
  outOfSpecAction?: string;
  estMinutes?: number;
  skillLevel?: "Entry" | "Intermediate" | "Journeyman" | "Specialist";
  oemRefs?: string[];
  standards?: string[];
  failureModes?: string[];
  // True when this is the explicit lockout/tagout transition step.
  isLotoTransition?: boolean;
  // True when this is the standardized close-out / return-to-service step, which
  // must always be sequenced LAST (after all contact work and guard reinstall).
  isCloseout?: boolean;
}

// Rank used to enforce correct sequencing: observations (running) come first,
// then the LOTO transition, then everything that requires the machine de-energized.
const STATE_RANK: Record<OperatingState, number> = {
  Running: 0,
  "Running under load": 0,
  "Running unloaded": 1,
  Stopped: 3,
  LOTO: 4,
};

const DEFAULT_OUT_OF_SPEC =
  "If any reading is out of specification or trending toward an alarm limit, do not return the machine to service blind — create a corrective work order documenting the measurement, the spec, and the deviation, and escalate per plant criticality.";

// The canonical LOTO transition step. Inserted exactly once, immediately before
// the first task that requires the machine de-energized (Stopped/LOTO), and only
// when such a task exists.
export function lotoTransitionStep(): PmTaskDetail {
  return {
    title: "Transition to a safe, de-energized state (Lockout / Tagout)",
    operatingState: "LOTO",
    isLotoTransition: true,
    purpose:
      "All remaining tasks require hands-on / contact work. Stored and live energy must be isolated and verified at zero before any guard is opened or any component is touched, to prevent crush, shock, arc-flash, and unexpected-startup injuries.",
    safety: [
      "Follow the machine-specific LOTO procedure; apply your personal lock and tag to each energy-isolating device.",
      "Isolate and verify ZERO energy across every source present on this machine: electrical, pneumatic, hydraulic, gravity/suspended loads, spring/stored mechanical, thermal, and chemical.",
      "Bleed down accumulators and air receivers; block or lower suspended loads; allow hot surfaces to cool.",
      "Verify de-energization by test (e.g. absence-of-voltage test with a proven meter) — do not assume an open disconnect means zero energy.",
    ],
    ppe: ["Arc-flash rated PPE appropriate to the incident energy", "Insulated gloves rated for the system voltage", "Safety glasses", "Cut-resistant gloves for mechanical work"],
    tools: ["Personal locks and tags", "Proven CAT III/IV voltage tester", "Group lockout box if multiple craftspeople"],
    procedure: [
      "Notify affected operators that the machine is being taken out of service.",
      "Shut down the machine using its normal stop sequence.",
      "Identify every energy source from the machine's energy-control procedure.",
      "Isolate each source and apply locks/tags.",
      "Release or block stored energy (pneumatic, hydraulic, mechanical, gravity, thermal).",
      "Verify zero energy by test before proceeding.",
    ],
    acceptanceCriteria: ["All energy sources isolated, locked, tagged, and verified at zero before any contact work begins."],
    estMinutes: 10,
    skillLevel: "Intermediate",
    standards: ["OSHA 29 CFR 1910.147 (The Control of Hazardous Energy)", "NFPA 70E (where electrical work is involved)"],
  };
}

// ── Type-aware task libraries ────────────────────────────────────────────────
// Each task is authored with its correct operatingState; sequenceTasks() handles
// ordering and LOTO insertion. Tasks are intentionally SPECIFIC to the machine
// type rather than one generic line repeated everywhere.

type TaskBank = {
  observation: PmTaskDetail[]; // running / safe-to-observe
  contact: PmTaskDetail[]; // require Stopped / LOTO
};

const OBS = (t: Partial<PmTaskDetail> & { title: string }): PmTaskDetail => ({
  operatingState: "Running",
  skillLevel: "Entry",
  estMinutes: 10,
  outOfSpecAction: DEFAULT_OUT_OF_SPEC,
  ...t,
});
const CONTACT = (t: Partial<PmTaskDetail> & { title: string }): PmTaskDetail => ({
  operatingState: "LOTO",
  skillLevel: "Journeyman",
  estMinutes: 20,
  outOfSpecAction: DEFAULT_OUT_OF_SPEC,
  ...t,
});

const BANKS: Record<string, TaskBank> = {
  motor: {
    observation: [
      OBS({
        title: "Observe motor operation from a safe location",
        purpose: "Catch developing bearing, balance, cooling, and electrical-loading problems before they cause an unplanned outage.",
        operatingState: "Running under load",
        procedure: [
          "From a safe location with guards in place, observe the motor running under normal load.",
          "Listen for bearing rumble/growl, electrical buzz at 2x line frequency, or scraping; note any change from normal.",
          "Look for excessive frame vibration, oil/grease slung onto surfaces, scorched paint, or smoke/odor.",
          "Confirm the cooling fan is turning freely and air paths are unobstructed.",
        ],
        measurements: ["Frame/bearing surface temperature (IR), drive-end and non-drive-end", "Audible/visual vibration vs. normal", "Running line current per phase (clamp ammeter), compared to nameplate FLA and to baseline"],
        acceptanceCriteria: ["Bearing/frame temperature within OEM limit and stable vs. baseline", "Phase currents balanced (within ~10%) and at or below nameplate FLA", "No abnormal noise, smoke, or odor"],
        tools: ["IR thermometer", "Clamp ammeter (true-RMS)"],
        failureModes: ["Bearing wear/failure", "Winding insulation breakdown", "Single-phasing / voltage imbalance", "Overheating from blocked cooling"],
      }),
      OBS({
        title: "Measure vibration at the bearings (running)",
        purpose: "Vibration trending is the earliest reliable indicator of bearing, balance, alignment, and looseness faults on rotating equipment.",
        operatingState: "Running under load",
        procedure: [
          "With the machine running under normal load, place the vibration analyzer/accelerometer at the drive-end and non-drive-end bearing housings.",
          "Record horizontal, vertical, and axial readings at each bearing.",
          "Compare to the historical baseline and to plant alarm limits.",
        ],
        measurements: ["Overall velocity (mm/s or in/s RMS) — H, V, A at DE and NDE bearings"],
        acceptanceCriteria: ["Readings at or below plant alarm limit and not significantly increased from baseline (per ISO 10816/20816 zone)"],
        tools: ["Vibration analyzer or data collector"],
        skillLevel: "Intermediate",
        standards: ["ISO 20816 (mechanical vibration evaluation)"],
        failureModes: ["Bearing defect", "Imbalance", "Misalignment", "Mechanical looseness"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Inspect motor housing, mounting, and connections",
        purpose: "Loose mounts, contaminated windings, and degraded terminations are common precursors to vibration damage and electrical failure.",
        procedure: [
          "Inspect the motor housing for overheating discoloration, oil/coolant contamination, cracked conduit fittings, and a damaged or clogged cooling fan/shroud.",
          "Check all mounting bolts and the baseplate for looseness, soft foot, and signs of fretting/movement; re-torque to spec.",
          "Open the conduit/terminal box; inspect for heat discoloration, loose lugs, and insulation damage; re-torque terminations to spec.",
        ],
        tools: ["Torque wrench", "Hand tools", "Inspection light"],
        measurements: ["Mounting-bolt torque vs. spec", "Termination torque vs. spec"],
        acceptanceCriteria: ["Housing clean and undamaged; no soft foot; all bolts and terminations at spec torque with no heat damage"],
        failureModes: ["Soft foot / loosened mounts driving vibration", "Loose terminations causing heating and single-phasing"],
      }),
      CONTACT({
        title: "Lubricate motor bearings per OEM specification",
        purpose: "Over- and under-greasing are both leading causes of premature bearing failure; correct grade, amount, and interval are essential.",
        procedure: [
          "Confirm the OEM-specified grease grade, quantity, and re-lube interval for this frame.",
          "Clean the grease fittings; remove the drain plug.",
          "Add only the specified amount of grease slowly; do not over-grease.",
          "Run briefly (if procedure allows) to purge, then reinstall the drain plug.",
        ],
        tools: ["Grease gun (calibrated/measured)", "OEM-specified grease"],
        parts: ["OEM-specified bearing grease (grade per nameplate/manual)"],
        acceptanceCriteria: ["Correct grade and measured quantity applied per OEM; no over-greasing; drain plug reinstalled"],
        skillLevel: "Intermediate",
        failureModes: ["Bearing failure from over/under-lubrication or incompatible grease"],
      }),
      CONTACT({
        title: "Measure winding insulation resistance (annual / as due)",
        purpose: "Insulation-resistance and polarization-index trending detects moisture ingress and insulation aging before a winding fault causes catastrophic failure.",
        procedure: [
          "With the motor de-energized, isolated, and leads disconnected per procedure, connect the insulation tester (megohmmeter).",
          "Measure insulation resistance phase-to-ground; record the 1-minute value and, if required, the 10-minute value for polarization index.",
          "Discharge the windings after the test.",
        ],
        measurements: ["Insulation resistance (MΩ), temperature-corrected", "Polarization index (10-min / 1-min ratio) where applicable"],
        acceptanceCriteria: ["Insulation resistance and PI meet or exceed IEEE 43 minimums for the winding class/voltage"],
        tools: ["Insulation resistance tester (megohmmeter)"],
        skillLevel: "Specialist",
        standards: ["IEEE 43 (insulation resistance testing)"],
        failureModes: ["Moisture-laden or aged insulation", "Contamination tracking"],
        estMinutes: 25,
      }),
    ],
  },
  conveyor: {
    observation: [
      OBS({
        title: "Walk the conveyor while running and observe drive, idlers, and take-up",
        purpose: "Hot bearings, seized idlers, and tracking drift are caught early by a running walk-down, preventing belt damage and fires.",
        operatingState: "Running under load",
        procedure: [
          "From a safe walkway with guards in place, walk the full length of the conveyor while it runs under normal load.",
          "Listen and feel (IR, not by hand) for hot or noisy bearings at the drive, idlers, pulleys, and take-up.",
          "Watch belt tracking across the carry and return runs; note any drift toward a frame edge.",
        ],
        measurements: ["Bearing/pulley surface temperature (IR) at drive, idlers, take-up", "Belt tracking offset vs. frame"],
        acceptanceCriteria: ["No bearing above OEM/IR alarm temperature; belt tracking centered (no edge contact); no abnormal noise"],
        tools: ["IR thermometer"],
        failureModes: ["Seized idler causing belt cut/fire", "Mistracking causing edge wear", "Drive bearing failure"],
      }),
      OBS({
        title: "Verify safety devices function (running)",
        purpose: "Pull-cords, e-stops, guarding, and zero-speed/photo-eye interlocks are the last line of defense for personnel and must be proven, not assumed.",
        operatingState: "Running",
        procedure: [
          "Function-test each pull-cord and e-stop in turn and confirm the conveyor stops and latches as designed (coordinate with operations).",
          "Confirm guards over nip points, return idlers, and the take-up are present and secure.",
          "Verify photo-eyes / zero-speed switches respond.",
        ],
        acceptanceCriteria: ["Every pull-cord and e-stop stops the conveyor and requires deliberate reset; all guards in place; interlocks respond"],
        skillLevel: "Entry",
        standards: ["ANSI/ASME B20.1 (conveyor safety)"],
        failureModes: ["Defeated/failed e-stop or pull-cord", "Missing nip-point guard"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Inspect and adjust belt, splice, tracking, and tension",
        purpose: "Splice failures and chronic mistracking are leading causes of conveyor downtime and belt replacement cost.",
        procedure: [
          "Inspect the full belt for cuts, gouges, fraying edges, and splice condition (mechanical or vulcanized).",
          "Check and adjust tracking using the troughing/return idlers and the head/tail pulley squareness — adjust gradually, one device at a time.",
          "Verify take-up tension is within range; adjust per OEM.",
        ],
        tools: ["Hand tools", "Tape measure", "Belt tracking gauge"],
        measurements: ["Take-up position vs. range", "Splice condition"],
        acceptanceCriteria: ["Belt undamaged or scheduled for replacement; tracking centered; take-up within range"],
        failureModes: ["Splice separation", "Edge damage from mistracking"],
      }),
      CONTACT({
        title: "Service idlers, pulleys, lagging, and lubricate per OEM",
        purpose: "Replacing seized idlers and worn lagging restores tracking and protects the belt.",
        procedure: [
          "Spin-check each idler; replace any that are seized, flat-spotted, or noisy.",
          "Inspect head/tail pulley lagging for wear and the pulleys for buildup; clean.",
          "Lubricate bearings per OEM grade and amount (do not over-grease); check gearbox oil level and condition.",
        ],
        tools: ["Grease gun", "Hand tools", "Replacement idlers as needed"],
        parts: ["Idlers (as found defective)", "OEM-specified grease"],
        acceptanceCriteria: ["No seized idlers; lagging serviceable; bearings lubed to spec; gearbox oil at level and clean"],
        failureModes: ["Seized idler", "Worn lagging causing slip", "Gearbox oil degradation"],
      }),
    ],
  },
  pump: {
    observation: [
      OBS({
        title: "Observe pump operation and record process readings (running)",
        purpose: "Seal leaks, cavitation, and bearing distress show up first in running pressures, temperatures, and noise.",
        operatingState: "Running under load",
        procedure: [
          "With the pump running at normal duty, observe the seal/packing area for leakage and the coupling guard for abnormal noise.",
          "Record suction and discharge pressures and compare to the baseline/curve.",
          "Listen for cavitation (gravel) or bearing noise; measure bearing temperatures by IR.",
        ],
        measurements: ["Suction & discharge pressure vs. baseline", "Bearing temperature (IR), DE & NDE", "Motor current per phase"],
        acceptanceCriteria: ["Pressures within expected band for duty point; bearing temps within limit; no visible seal leak beyond allowable; no cavitation"],
        tools: ["IR thermometer", "Clamp ammeter"],
        failureModes: ["Mechanical seal failure", "Cavitation / suction restriction", "Bearing wear"],
      }),
      OBS({
        title: "Measure pump/motor vibration (running)",
        purpose: "Vibration trending detects misalignment, imbalance, and bearing faults before secondary damage.",
        operatingState: "Running under load",
        procedure: ["Record H/V/A vibration at pump and motor bearings under normal duty and compare to baseline and alarm limits."],
        measurements: ["Overall velocity (mm/s RMS) at pump & motor bearings"],
        acceptanceCriteria: ["Within plant alarm limit and stable vs. baseline (ISO 20816 zone)"],
        tools: ["Vibration analyzer"],
        skillLevel: "Intermediate",
        standards: ["ISO 20816"],
        failureModes: ["Misalignment", "Imbalance", "Bearing defect"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Inspect/replace mechanical seal or packing and check coupling alignment",
        purpose: "The seal and coupling alignment dominate pump reliability; correcting them prevents repeat seal failures.",
        procedure: [
          "Inspect the mechanical seal / packing; adjust packing or schedule seal replacement if leakage exceeds allowable.",
          "Check pump-to-motor coupling alignment (dial or laser); correct to OEM tolerance.",
          "Lubricate bearings per OEM spec; verify strainer/filter condition and clean.",
        ],
        tools: ["Laser alignment tool", "Hand tools", "Grease gun"],
        parts: ["Mechanical seal kit (if replacing)", "OEM-specified grease"],
        measurements: ["Coupling offset/angularity vs. tolerance"],
        acceptanceCriteria: ["Alignment within OEM tolerance; seal not leaking beyond allowable; strainer clean"],
        skillLevel: "Journeyman",
        failureModes: ["Repeat seal failure from misalignment", "Strainer fouling"],
      }),
    ],
  },
  gearbox: {
    observation: [
      OBS({
        title: "Observe gearbox running condition (running)",
        purpose: "Oil temperature, leaks, and gear/bearing noise indicate lubrication and wear problems early.",
        operatingState: "Running under load",
        procedure: [
          "With the drive running, listen for gear whine, bearing rumble, or knocking and note any change.",
          "Measure case temperature by IR; check for leaks at seals, gaskets, and the breather.",
        ],
        measurements: ["Case temperature (IR)", "Audible gear/bearing condition"],
        acceptanceCriteria: ["Case temperature within OEM limit; no active leaks; no abnormal gear/bearing noise"],
        tools: ["IR thermometer"],
        failureModes: ["Gear tooth wear/pitting", "Bearing failure", "Seal leak / low oil"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Check oil level/condition and inspect seals, breather, and mounting",
        purpose: "Lubrication condition is the dominant gearbox failure driver; catching it protects gears and bearings.",
        procedure: [
          "Check oil level and condition; sample for viscosity/particle/water if the program requires; top up with the correct grade only.",
          "Inspect seals, gaskets, and the breather; replace a clogged breather.",
          "Verify mounting-bolt torque and guard integrity.",
        ],
        tools: ["Hand tools", "Oil sample kit", "Torque wrench"],
        parts: ["OEM-specified gear oil (top-up/change)", "Breather (if clogged)"],
        measurements: ["Oil level", "Oil condition (sample results if taken)", "Mounting torque vs. spec"],
        acceptanceCriteria: ["Oil at correct level, correct grade, within condition limits; breather clear; mounts at spec torque"],
        failureModes: ["Lube degradation/contamination", "Breather blockage causing seal blow-out"],
      }),
      CONTACT({
        title: "Annual: full oil change, magnetic plug inspection, and bearing trend review",
        operatingState: "LOTO",
        purpose: "Scheduled oil renewal and wear-debris inspection reset the wear clock and reveal internal distress.",
        procedure: [
          "Drain and refill with the OEM-specified oil and quantity.",
          "Inspect the magnetic drain plug for wear metal; characterize quantity/type.",
          "Review bearing vibration/temperature trend; replace bearings if out of spec.",
        ],
        tools: ["Hand tools", "Drain pan", "Vibration analyzer"],
        parts: ["OEM gear oil (full charge)", "Drain-plug gasket", "Bearings (if due)"],
        acceptanceCriteria: ["Correct oil charged; negligible wear debris; bearing trend within limits"],
        skillLevel: "Journeyman",
        estMinutes: 45,
        failureModes: ["Bearing spall", "Gear pitting", "Lube oxidation"],
      }),
    ],
  },
  drive: {
    observation: [
      OBS({
        title: "Observe drive/VFD operation and log faults (running)",
        purpose: "Heatsink overheating, cooling-fan failure, and recurring faults are caught from the running drive before a trip stops production.",
        operatingState: "Running under load",
        procedure: [
          "With the drive running the motor under load, read and record any active faults/warnings and the fault history.",
          "Record DC bus voltage and heatsink temperature from the drive display.",
          "Confirm the cooling fan runs and air filters/vents are clear; check cabinet temperature.",
        ],
        measurements: ["DC bus voltage", "Heatsink temperature", "Output current vs. motor FLA", "Active/most-recent faults"],
        acceptanceCriteria: ["No recurring fault trend; heatsink temp within limit; cooling fan operating; cabinet temperature within spec"],
        tools: ["None (read from drive HMI)", "IR thermometer for cabinet"],
        failureModes: ["Cooling fan failure / dust blockage", "DC bus capacitor aging", "Nuisance trips from loose terminations"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Clean cabinet, re-torque power/ground terminations, service cooling",
        purpose: "Loose terminations and dust-blocked cooling are the top causes of drive heating faults and failures.",
        procedure: [
          "With the drive isolated and the DC bus verified discharged, vacuum/blow out dust from the cabinet and heatsink.",
          "Re-torque power and ground terminations to spec; inspect for discoloration/heat.",
          "Clean or replace cooling fan filters; verify fan operation.",
        ],
        tools: ["Torque screwdriver/wrench", "ESD-safe vacuum", "Proven voltage tester"],
        parts: ["Cabinet filter media (if due)", "Cooling fan (if failed)"],
        measurements: ["DC bus verified discharged before contact", "Termination torque vs. spec"],
        acceptanceCriteria: ["DC bus discharged and verified; cabinet clean; terminations at spec; cooling restored"],
        safety: ["VERIFY THE DC BUS IS DISCHARGED with a proven meter before touching power terminals — capacitors hold lethal voltage after isolation."],
        skillLevel: "Specialist",
        standards: ["NFPA 70E"],
        failureModes: ["Capacitor failure", "Loose-termination heating"],
      }),
      CONTACT({
        title: "Annual: parameter/firmware backup and capacitor/cooling assessment",
        purpose: "A current backup enables fast recovery; capacitor health governs drive remaining life.",
        procedure: [
          "Back up the drive parameter set (and firmware version) to a controlled location.",
          "Assess DC bus capacitor health per OEM method; note reform/replace recommendations.",
        ],
        tools: ["Laptop/HMI with drive software"],
        acceptanceCriteria: ["Verified parameter/firmware backup stored; capacitor assessment recorded"],
        skillLevel: "Specialist",
        failureModes: ["Unrecoverable config loss after a failure", "Aged DC bus capacitors"],
        estMinutes: 20,
      }),
    ],
  },
  compressor: {
    observation: [
      OBS({
        title: "Observe compressor operation and record discharge conditions (running)",
        purpose: "Leaks, high discharge temperature, and load/unload faults indicate cooling, valve, and control problems early.",
        operatingState: "Running under load",
        procedure: [
          "With the compressor running, check for air/oil leaks and record discharge pressure and temperature.",
          "Confirm load/unload (or modulation) operates at the correct setpoints.",
          "Inspect/clean the intake filter indicator; check belt condition/tension by sight.",
        ],
        measurements: ["Discharge pressure & temperature", "Intake filter restriction indicator", "Load/unload setpoints"],
        acceptanceCriteria: ["Discharge within spec; no leaks; load/unload at setpoint; intake filter not in alarm"],
        tools: ["IR thermometer"],
        failureModes: ["Air/oil separator degradation", "Cooler fouling", "Valve/unloader malfunction"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Service filters/separators, drain condensate, check coolers and safety valve",
        purpose: "Filter/separator and cooler maintenance protect the airend and prevent oil carryover and overheating.",
        procedure: [
          "Drain condensate; check oil level and top up with correct grade.",
          "Change/clean air and oil separators per run-hours; inspect and clean coolers.",
          "Verify the safety relief valve tag/test date; test the pressure switch / load-unload setpoints.",
        ],
        tools: ["Hand tools", "Drain pan"],
        parts: ["Air filter element", "Oil separator element", "Compressor oil (correct grade)"],
        measurements: ["Oil level", "Separator hours vs. interval"],
        acceptanceCriteria: ["Condensate drained; filters/separators within life; coolers clean; relief valve in date"],
        failureModes: ["Separator saturation → oil carryover", "Cooler fouling → high-temp trip"],
      }),
    ],
  },
  general: {
    observation: [
      OBS({
        title: "Observe equipment operation from a safe location (running)",
        purpose: "A structured running observation catches the majority of developing faults — heat, noise, vibration, and leaks — before they cause failure.",
        operatingState: "Running",
        procedure: [
          "With guards in place, observe the equipment running under normal conditions.",
          "Identify, by name for THIS machine, what to look and listen for: abnormal noise at bearings/gears/drives, visible vibration, fluid leaks at seals/fittings, heat/discoloration, and any alarm indicators.",
          "Record key running readings against the established baseline.",
        ],
        measurements: ["Surface/bearing temperature (IR) at key points", "Running current (if motor-driven)", "Any process readings relevant to this machine (pressure, flow, speed)"],
        acceptanceCriteria: ["All running readings within limits and stable vs. baseline; no abnormal noise, leak, or heat"],
        tools: ["IR thermometer", "Clamp ammeter (if applicable)"],
        failureModes: ["Bearing wear", "Leaks", "Overheating", "Loose components"],
      }),
      OBS({
        title: "Verify guards, e-stops, and safety devices function (running)",
        purpose: "Safety interlocks must be proven functional to protect personnel.",
        operatingState: "Running",
        procedure: ["Function-test e-stops and safety interlocks (coordinate with operations); confirm guards are present and secure."],
        acceptanceCriteria: ["All safety devices function and latch; guards in place"],
        skillLevel: "Entry",
        failureModes: ["Defeated or failed safety device"],
      }),
    ],
    contact: [
      CONTACT({
        title: "Lubricate, inspect wear items, and re-torque critical fasteners/terminations",
        purpose: "Lubrication and fastener integrity prevent the most common mechanical and electrical failures.",
        procedure: [
          "Lubricate per OEM grade/amount/interval (do not over-grease).",
          "Inspect wear items (belts, chains, seals, filters) and adjust or replace as needed.",
          "Re-torque critical fasteners and electrical terminations to spec; inspect for heat damage.",
        ],
        tools: ["Grease gun", "Torque wrench", "Hand tools"],
        parts: ["OEM-specified lubricant", "Wear items as found"],
        measurements: ["Fastener/termination torque vs. spec"],
        acceptanceCriteria: ["Lubed to spec; wear items serviceable; fasteners/terminations at spec with no heat damage"],
        failureModes: ["Lube-related wear", "Loose-termination heating", "Belt/chain wear"],
      }),
      CONTACT({
        title: "Annual: comprehensive condition assessment and life-limited component review",
        purpose: "An annual deep assessment trends the asset and replaces life-limited parts before they fail.",
        procedure: [
          "Perform condition monitoring appropriate to the machine (vibration, thermography, electrical testing) and trend vs. baseline.",
          "Replace life-limited components per OEM hours; sample/replace fluids.",
          "Verify alignment and calibrate drives, sensors, and safety interlocks.",
        ],
        tools: ["Vibration analyzer", "Thermal camera", "Calibration tools"],
        acceptanceCriteria: ["Condition trends within limits; life-limited parts replaced; calibration verified"],
        skillLevel: "Specialist",
        estMinutes: 60,
        failureModes: ["End-of-life component failure", "Calibration drift"],
      }),
    ],
  },
};

// Pick the task bank for a detected machine type, defaulting to general.
export function taskBankFor(type: string): TaskBank {
  return BANKS[type] ?? BANKS.general;
}

// Build the cadence-appropriate, CORRECTLY-SEQUENCED list of structured tasks.
// - 30/60-day: observation + light contact (lube/inspect)
// - 90-day: + the standard contact set
// - semi-annual/annual: + the heavier "annual" contact tasks (estMinutes >= 40
//   or titled "Annual") and full condition assessment
//
// sequenceTasks() guarantees: observations first (Running), then a single LOTO
// transition, then all contact tasks (Stopped/LOTO). The standardized close-out
// step is always last.
export function buildCadenceTasks(type: string, days: number): PmTaskDetail[] {
  const bank = taskBankFor(type);
  const isQuarterlyPlus = days >= 90;
  const isAnnualPlus = days >= 180;

  const tasks: PmTaskDetail[] = [];
  // Observations always included.
  tasks.push(...bank.observation);

  // Contact tasks: the lighter ones for short cadences; add heavier/annual ones
  // for longer cadences.
  for (const c of bank.contact) {
    const heavy = /annual/i.test(c.title) || (c.estMinutes ?? 0) >= 40 || c.skillLevel === "Specialist";
    if (heavy) {
      if (isAnnualPlus) tasks.push(c);
    } else if (days <= 60) {
      // For monthly/60-day, include only the first (lightest) contact task —
      // typically lubrication/inspection — to keep the interval realistic.
      if (bank.contact.indexOf(c) === 0) tasks.push(c);
    } else if (isQuarterlyPlus || days > 60) {
      tasks.push(c);
    }
  }

  // Standardized close-out (always Stopped/LOTO context, documentation).
  tasks.push({
    title: "Return to service: remove LOTO, function-test, record baseline, and document findings",
    operatingState: "Stopped",
    isCloseout: true,
    purpose: "Confirms the machine is safe and correct to return to service and closes the loop by capturing readings and raising corrective work for anything out of spec. This is always the final step, performed only after all contact work is complete and guards are reinstalled.",
    procedure: [
      "Remove locks/tags per the LOTO procedure once all contact work is complete and guards are reinstalled.",
      "Function-test the machine under load; record baseline readings (current, temperature, vibration, pressure as applicable).",
      "Document all findings, measurements, and parts used in the PM record.",
      "Raise a corrective work order for anything found out of specification.",
    ],
    acceptanceCriteria: ["Machine returned to service operating within baseline; all findings documented; corrective WOs raised for out-of-spec items"],
    estMinutes: 15,
    skillLevel: "Intermediate",
    outOfSpecAction: DEFAULT_OUT_OF_SPEC,
  });

  return sequenceTasks(tasks);
}

// Enforce correct operating-state sequencing and insert exactly one explicit
// LOTO transition step immediately before the first task that requires the
// machine de-energized. This is the deterministic guard that fixes the
// "LOTO before observation" bug regardless of authored order.
export function sequenceTasks(tasks: PmTaskDetail[]): PmTaskDetail[] {
  // Separate the close-out (always last) and any pre-existing LOTO transition
  // (we insert our own canonical one) from the body tasks before sorting.
  const closeouts = tasks.filter((t) => t.isCloseout);
  const body = tasks.filter((t) => !t.isCloseout && !t.isLotoTransition);

  // Stable sort the body by operating-state rank so observations (Running)
  // precede contact work (Stopped/LOTO).
  const sorted = body
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ra = STATE_RANK[a.t.operatingState] ?? 2;
      const rb = STATE_RANK[b.t.operatingState] ?? 2;
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .map((x) => x.t);

  const firstContactIdx = sorted.findIndex(
    (t) => t.operatingState === "Stopped" || t.operatingState === "LOTO"
  );

  // Body sequenced with a single LOTO transition before the first contact task
  // (if any contact work exists).
  const sequencedBody =
    firstContactIdx === -1
      ? sorted
      : [
          ...sorted.slice(0, firstContactIdx),
          lotoTransitionStep(),
          ...sorted.slice(firstContactIdx),
        ];

  // Close-out is ALWAYS last — it removes LOTO, function-tests, and documents,
  // so it can only run after every contact task and guard reinstall.
  return [...sequencedBody, ...closeouts];
}

// Render a structured task to a single human-readable instruction line for the
// `instruction` (title) column and for any legacy/plain consumer. The full
// structure lives in the `detail` JSON.
export function taskTitleLine(t: PmTaskDetail): string {
  return `[${t.operatingState}] ${t.title}`;
}
