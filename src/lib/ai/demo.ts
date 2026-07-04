import type { RetrievedChunk } from "@/lib/rag/retrieve";
import { buildGroundedFromDocuments } from "./grounded";
import { buildFaultCodeAnswer } from "./expert";

// Offline reasoning engine. Not a real LLM — a curated template engine that
// produces correctly-structured, domain-plausible answers so the product is
// fully demoable with zero configuration. Live mode (Anthropic) replaces this.
// Diagnostic answers follow the exact EAS response format.

interface DemoCase {
  match: RegExp;
  build: (q: string) => string;
}

function refs(ctx: RetrievedChunk[]): string {
  if (!ctx.length)
    return "- General industrial knowledge — no plant documents matched this query.";
  return ctx
    .slice(0, 4)
    .map((c) => `- ${c.filename}${c.kind ? ` (${c.kind})` : ""} — excerpt #${c.ordinal + 1}`)
    .join("\n");
}

const CASES: DemoCase[] = [
  {
    // ── Killer demo ── Conveyor 3 "trips after ~20 minutes" (F007 overload).
    // Grounded in the seeded PowerFlex 525 manual, Conveyor 3 drawing, and prior
    // work orders. Matches the exact pitch question.
    match: /conveyor\s*3|conv3|trips? (after|around)?\s*~?\s*(20|twenty)\s*min|20 minutes|after 20/i,
    build: () => `## Problem Summary
Conveyor 3 running fine on a **cold start** but tripping on **PowerFlex 525 Fault F007 (motor overload) ~20 minutes into a run** is a *thermal / progressive-mechanical* problem — current rises as the system heats. It is **not** an accel-time problem (that would trip at start). This exact machine has done this before; the proven first check is the **VFD-CONV3 panel cooling (intake filter PF-3)**, then belt tracking and the motor drive-end bearing. Do **not** raise the drive overload limit to mask it.

## Most Likely Causes
| Cause | Probability | Why |
|---|---|---|
| VFD panel overheating — clogged intake filter PF-3 / failed panel fan | 40% | Resolved this exact symptom on WO-100431; drive heat-soaks in ~20 min and the OL model trips F007 |
| Mechanical drag that grows with heat — belt mistracking / take-up | 25% | Caused the same complaint on WO-100201; drag rises as the belt warms and stretches |
| Motor drive-end bearing degrading (runs warm) | 18% | Flagged warm on PM WO-100388; rising friction raises running current over time |
| Drive OL parameter set too tight (P034 vs motor FLA 7.6 A) | 10% | A marginal OL setting clips the warm-running current |
| Gearbox lubrication / cold-vs-warm viscosity | 7% | Less likely given the "worse when warm" signature |

## Recommended Troubleshooting Order
1. **Trend the drive output current** (PowerFlex 525 parameter **b003**) from cold start to the trip. A steady climb toward the OL limit confirms thermal/mechanical; a sudden spike means a jam or short.
2. **Check the VFD-CONV3 panel first** — panel temperature and intake filter **PF-3**. Per drawing E-CONV3-014 Rev C the panel runs ~15 °C over ambient and heat-soaks in 20-30 min if the filter clogs or fan fails. (This was the fix on WO-100431.)
3. **Inspect belt tracking and tail take-up.** Look for the belt rubbing the frame (the WO-100201 root cause). Re-track and adjust take-up if drag is present.
4. **Check the motor drive-end bearing temperature** with an IR thermometer — it was logged warm on PM WO-100388. Compare to the non-drive end.
5. **Verify drive OL settings:** P034 = motor FLA (7.6 A), class 10. Do not raise it to stop the trip.

## Required Tools
- True-RMS clamp ammeter and/or a laptop running Connected Components Workbench (to read b003)
- IR thermometer / thermal camera
- Replacement VFD panel intake filter (PF-3)
- Belt tracking gauge, wrenches for take-up

## Required Spare Parts
- VFD-CONV3 panel intake air filter (PF-3)
- Conveyor belt take-up / tracking hardware as needed
- Motor drive-end bearing — stage only if temperature confirms it (verify P/N against the motor nameplate)

## Safety Considerations
- LOTO Conveyor 3 before any contact work; the PowerFlex DC bus holds **lethal voltage up to 5 minutes** after power-off — verify 0 VDC on the bus caps.
- A restart can command the conveyor to run — clear personnel from nip points and the belt path first.
- The E-stop / gate-guard string feeds the drive STO (F059 if opened) — coordinate before defeating any guard.

## Estimated Repair Time
**~42 minutes** for a qualified tech if it's the panel filter (matches the proven WO-100431 fix); 30-90 minutes if mechanical. Downtime ~1 hour.

## Confidence
**High** — this machine's own history and documents point to the VFD panel cooling as the most probable cause, with belt tracking and the motor bearing as the next checks.

## Sources Used
{{REFS}}`,
  },
  {
    // ── Memory layer ── "Why did Pump 12 fail?" style asset-history question.
    match: /why (did|has|does).*(pump|motor|conveyor|gearbox|asset|machine).*(fail|keep|trip)|failure history|how many times.*(fail)|pump 12/i,
    build: (q) => `## Problem Summary
Here is what this asset's **memory** shows for: *"${summarizeRequest(q)}"*. EAS reasons over every prior work order, lesson learned, and PM for the machine before answering — so you get the pattern, not just a single fix.

## Failure History
| # | When | Root Cause | Resolution | Tech | Time |
|---|---|---|---|---|---|
| 1 | ~16 weeks ago | Mechanical drag (belt mistracking) | Re-tracked belt, adjusted take-up | Mike R. | 55 min |
| 2 | ~11 weeks ago | (PM) drive-end bearing logged warm | Greased, flagged for trend | Dana P. | 35 min |
| 3 | ~8 weeks ago | VFD panel overheating (clogged filter) | Replaced intake filter, cleaned exhaust | Mike R. | 42 min |

## What the Pattern Tells Us
- The recurring complaint is an **overload/trip that only appears after the machine warms up (~20 min)** — never on a cold start.
- **Two dominant root causes:** VFD panel cooling (filter/fan) and progressive mechanical drag (belt tracking / warm bearing).
- **Mike R. resolved the fastest case in 42 minutes** by going straight to the panel cooling first.

## Recommended Action
1. Treat any future "trips after it warms up" call as thermal/mechanical: check VFD panel cooling first, then belt tracking and the motor bearing.
2. **Change the PM interval** — add a *monthly* VFD panel filter check (currently only on the quarterly PM) and trend the drive-end bearing temperature.
3. Stage a spare panel filter and the motor bearing so the next event is a planned, sub-hour fix.

## Confidence
**High** — grounded in this asset's own work-order history and captured lesson learned.

## Sources Used
{{REFS}}`,
  },
  {
    // Allen-Bradley PowerFlex fault codes
    match: /powerflex|f0?81|f0?59|f0?07|vfd|drive fault|fault f/i,
    build: () => `## Problem Summary
A PowerFlex **F081** is a *Loss of Comms (DPI/Network)* fault — the drive stopped receiving its control connection. The single most important first action is to verify the network/comms cable and the controller scanner, **not** the motor.

## Most Likely Causes
| Cause | Probability | Why |
|---|---|---|
| Loose / damaged comms cable or connector | 45% | Vibration loosens RJ45/DPI connectors over time; most common F081 root cause |
| PLC / scanner in program or faulted | 25% | If the controlling PLC drops the connection, the drive sees comms loss |
| Network switch / media converter fault | 18% | Failed port or power-cycled switch breaks the EtherNet/IP path |
| Drive comms adapter (25-COMM / embedded ENet) failing | 12% | Adapter firmware/hardware fault, less common |

## Recommended Troubleshooting Order
1. At the HMI/drive keypad, read the fault buffer and timestamp. Note if F081 correlates with line vibration or a shift change.
2. Inspect and reseat the network cable at the drive **and** the switch. Look for bent pins, crushed cable near moving guards. Use a cable tester — expect all 4 pairs good.
3. Ping the drive's IP from a laptop on the same subnet. Good = stable replies; bad = timeouts → trace the switch/port.
4. Check the controlling PLC: is it in RUN? Any I/O or connection faults in the controller log?
5. If comms is clean but the fault persists, swap/upgrade the comms adapter and re-flash firmware.

## Required Tools
- Cat5e/6 cable tester
- Laptop with EtherNet/IP tools (Studio 5000 / Connected Components Workbench)
- Multimeter rated CAT III 600V+
- Insulated screwdriver set

## Required Spare Parts
- Replacement network patch cable
- 25-COMM-E2P / embedded EtherNet adapter (verify P/N against the drive nameplate/BOM)

## Safety Considerations
- The drive DC bus holds **lethal voltage for up to 5 minutes** after power-off — if you open the drive, LOTO and verify 0 VDC on the bus caps with a meter.
- Restarting the drive may command the motor to run — clear personnel from the conveyor/machine first.
- Arc-flash rated PPE for any energized verification.

## Estimated Repair Time
20–45 minutes for a qualified tech; 30–60 minutes of line downtime.

## Confidence
**Medium** — would rise to High with the drive's parameter set and the network topology in hand.

## Sources Used
{{REFS}}`,
  },
  {
    // Conveyor overload, especially "every morning" / cold start
    match: /conveyor.*(overload|trip|fault)|overload.*conveyor|every morning|cold start/i,
    build: () => `## Problem Summary
A conveyor that overloads **every morning** but runs fine once warm is almost always a **temperature/lubrication** problem — cold grease and contracted components raise breakaway torque. Start by trending the morning motor current vs. ambient temperature.

## Most Likely Causes
| Cause | Probability | Why |
|---|---|---|
| Cold, stiff gearbox/bearing lubricant (high breakaway torque) | 40% | Classic "only in the morning" signature; grease viscosity spikes when cold |
| Product/debris frozen or stuck to belt overnight | 22% | Especially in cold storage / food plants; adds load at startup |
| Overload relay set too tight / aging | 18% | Marginal trip point clips the normal cold-start inrush |
| Misalignment or seized idler developing | 12% | Mechanical drag that's worst before the line warms |
| Soft-start/VFD accel ramp too aggressive | 8% | Too-fast ramp on a heavy cold load trips on current |

## Recommended Troubleshooting Order
1. LOTO the conveyor. Manually rotate the drive by hand — note if it's notably harder to turn cold. Hard = mechanical/lube.
2. With power on (guards in place), clamp-meter the motor amps at the first cold start vs. mid-shift. A large cold-vs-warm delta confirms breakaway torque.
3. Compare measured FLA to the motor nameplate and the overload relay setting. Relay should be ~115–125% of FLA.
4. Inspect gearbox oil level/grade and bearing lube. Cold-climate areas may need a lower-viscosity (synthetic) lubricant.
5. If VFD-driven, lengthen the accel ramp and/or enable torque-boost for cold starts.

## Required Tools
- Clamp-on ammeter (true-RMS)
- IR thermometer / thermal camera
- Wrenches for guard + gearbox inspection plug

## Required Spare Parts
- Correct-grade gearbox oil / synthetic bearing grease
- Overload relay or heater element (verify rating against motor FLA)

## Safety Considerations
- LOTO before hand-rotating or inspecting the belt/nip points — a conveyor that starts on you is a crush/amputation hazard.
- In cold storage: dress for the environment and watch for ice underfoot.

## Estimated Repair Time
30–90 minutes for a qualified tech; much of the diagnosis happens at run-time so downtime can be near zero.

## Confidence
**Medium** — would rise to High with a week of morning vs. mid-shift amp trends for this conveyor.

## Sources Used
{{REFS}}`,
  },
  {
    // Servo hunting / oscillation
    match: /servo.*(hunt|oscillat|unstable|vibrat)|hunting/i,
    build: () => `## Problem Summary
A "hunting" servo is oscillating around its commanded position — almost always a **tuning/inertia-mismatch** issue or growing **mechanical backlash**. Start by checking whether the gains were recently changed or whether mechanical lash has increased.

## Most Likely Causes
| Cause | Probability | Why |
|---|---|---|
| Gain set too high for the load (proportional/velocity loop) | 38% | Over-stiff loop overshoots and oscillates |
| Inertia mismatch / load inertia changed | 24% | Auto-tune assumed a different inertia ratio |
| Mechanical backlash, worn coupling or loose mount | 22% | Lash makes the encoder chase a moving target |
| Encoder/feedback noise or coupling slip | 16% | Bad feedback corrupts the position loop |

## Recommended Troubleshooting Order
1. Review the drive's tuning history — was it auto-tuned recently or after a mechanical change?
2. With the axis safe, grab the load and feel for backlash/lash in the coupling and gearbox. Any play = mechanical first.
3. Capture a step response / scope trace in the drive software. Slowly decaying ring = too much gain; sustained oscillation = instability.
4. Re-run auto-tune with the actual load, or lower velocity-loop gain and raise the low-pass filter until it stops.
5. Inspect the encoder cable shielding/grounding for noise pickup.

## Required Tools
- Drive configuration software (Studio 5000 / Kinetix, Sinamics Startdrive)
- Dial indicator (to quantify backlash)
- Oscilloscope or the drive's built-in trace

## Required Spare Parts
- Coupling / coupling insert
- Encoder cable (verify P/N)

## Safety Considerations
- A servo axis can move suddenly and with high force — use safe-torque-off or LOTO before touching the mechanics.
- Vertical axes hold stored energy: a brake release can drop the load.

## Estimated Repair Time
30–120 minutes depending on whether it's tuning or mechanical; 30–90 minutes downtime.

## Confidence
**Medium** — a scope trace of the oscillation would move this to High quickly.

## Sources Used
{{REFS}}`,
  },
  {
    // Work order generation
    match: /work order|generate (a )?wo\b|create.*work order/i,
    build: (q) => `## Work Order (Draft)

**Title:** ${summarizeRequest(q)}
**Priority:** High
**Type:** Corrective Maintenance
**Status:** Open

### Description
${q}

### Tasks
1. Perform LOTO and verify zero energy state.
2. Diagnose per Copilot troubleshooting guidance.
3. Repair / replace affected component.
4. Function-test and return to service.
5. Update asset history and close work order.

### Safety
- LOTO required. Verify stored energy (electrical bus, hydraulic accumulators, suspended loads) is discharged.
- Required PPE: arc-flash rated if energized verification is needed.

### Estimated Labor
- 1 technician × 1.5 hr (adjust after diagnosis)

### Sources Used
{{REFS}}

> Tip: attach this work order to the asset profile so it joins the machine's failure history.`,
  },
  {
    // PM generation
    match: /\bpm\b|preventive maintenance|generate.*pm|pm procedure/i,
    build: (q) => `## Preventive Maintenance Procedure (Draft)

**Asset/Scope:** ${summarizeRequest(q)}
**Frequency:** Monthly (adjust to RCM criticality)
**Estimated duration:** 45 min

### Safety First
- LOTO the equipment and verify zero energy.
- Confirm stored energy is discharged (electrical, hydraulic, pneumatic, gravity).

### PM Steps
1. Visual inspection — leaks, damage, loose hardware, abnormal wear.
2. Clean and inspect electrical connections; thermal-scan under load if accessible.
3. Check lubrication levels/condition; grease per spec (correct grade, correct amount — do not over-grease).
4. Inspect belts/chains/couplings for wear, tension, alignment.
5. Verify safety devices (e-stops, guards, light curtains) function.
6. Record vibration/temperature baseline readings.
7. Document findings; create corrective WOs for anything out of spec.

### Consumables
- Correct-grade lubricant, cleaning supplies, replacement fasteners as needed.

### Sources Used
{{REFS}}`,
  },
  {
    // RCA writeup
    match: /rca|root cause|5.?why|fishbone/i,
    build: (q) => `## Root Cause Analysis (Draft)

**Problem Statement:** ${summarizeRequest(q)}
**Date:** (fill in)  •  **Team:** (fill in)

### What Happened
${q}

### 5-Whys
1. **Why** did the failure occur? → (immediate cause)
2. **Why** did that happen? → (contributing condition)
3. **Why** ...? → (system/process gap)
4. **Why** ...? → (latent cause)
5. **Why** ...? → (root cause)

### Contributing Factors (Fishbone)
- **Machine:** wear, design, maintenance gaps
- **Method:** procedures, PM adequacy
- **Material:** parts quality, lubrication
- **Manpower:** training, staffing
- **Measurement:** missing condition monitoring
- **Environment:** temperature, contamination, vibration

### Root Cause(s)
(Summarize the validated root cause here.)

### Corrective & Preventive Actions
| Action | Owner | Due | Type |
|---|---|---|---|
| (immediate fix) | | | Corrective |
| (PM/design change) | | | Preventive |

### Sources Used
{{REFS}}`,
  },
];

function summarizeRequest(q: string): string {
  const clean = q.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? clean.slice(0, 77) + "…" : clean;
}

// Real, symptom-class general guidance for the common cases a maintenance tech
// actually types. This is genuine engineering knowledge (NOT fabricated
// plant-specific data or fake probability tables) and is clearly labelled as
// general so it can never be mistaken for this plant's own records.
interface GuidanceTopic {
  match: RegExp;
  title: string;
  causes: string; // "cause — why" bullet lines
  checks: string; // numbered steps
  tools: string;
  parts: string;
}

const GUIDANCE: GuidanceTopic[] = [
  {
    match: /\brtd\b|thermocouple|\btc\b|temp(erature)? (sensor|probe|input|reading)|pt100|pt1000|faulted temp/i,
    title: "Temperature sensor (RTD / thermocouple) faulted or reading bad",
    causes: [
      "**Open circuit — broken lead or loose terminal** — the most common RTD/TC fault; an open element drives the analog channel to its over/under-range fault state.",
      "**Failed sensing element** — the RTD/TC itself is open or drifted out of tolerance.",
      "**Wiring / lead-resistance error** — a 3-wire RTD with unequal or miswired compensation legs, or the wrong 2/3/4-wire landing, reads wrong or faults.",
      "**Bad analog input channel or module** — a failed channel or a module in a fault/over-range state, less common than a field-side open.",
    ].join("\n"),
    checks: [
      "LOTO as required; the sensor circuit is low voltage but the machine it controls may not be.",
      "At the sensor, disconnect and **measure resistance across the element**. A Pt100 reads ~100 Ω at 0 °C and ~110 Ω near room temp; **open (OL / infinite) = broken element or lead**, **~0 Ω = shorted**. For a thermocouple, check for continuity and correct polarity.",
      "For a 3-wire RTD, measure each lead pair — the two compensation legs should read **equal, low** resistance. Unequal legs = wiring/terminal problem.",
      "Reseat and torque every terminal from the sensor head → junction box → input card. Look for corrosion, a backed-out ferrule, or a broken strand.",
      "Confirm the wire lands on the **correct module channel** and the channel is configured for the right sensor type (RTD vs TC, Pt100 vs Pt1000, 2/3/4-wire).",
      "**Move the field wiring to a known-good spare channel** (or jump a resistor/decade box in place of the sensor). If the fault follows the wiring, it's field-side; if it stays on the channel, the module is suspect.",
      "Read the module's diagnostic/status bits for over-range / under-range / open-circuit to confirm which failure mode the controller sees.",
    ].join("\n"),
    tools: "Precision DMM (Ω), RTD/thermocouple loop calibrator or decade resistance box, small insulated screwdrivers, contact cleaner.",
    parts: "Matching RTD element or thermocouple (verify Pt100 vs Pt1000 and 2/3/4-wire, or TC type J/K), sensor lead/connector; analog input module ONLY if the channel is proven bad.",
  },
  {
    match: /overload|overcurrent|drawing (high )?amps|\bol\b trip|motor.*(trip|hot)/i,
    title: "Motor / drive overload trip",
    causes: [
      "**Mechanical load increase** — added drag, misalignment, or a seizing bearing raises running current until the overload trips.",
      "**Overload relay set too tight or aging** — a marginal setting clips normal running current.",
      "**Supply / winding problem** — single-phasing, voltage imbalance, or a degrading winding raises current.",
      "**Thermal / cooling** — clogged filters or a failed fan let the motor or drive heat-soak and trip after it warms.",
    ].join("\n"),
    checks: [
      "LOTO and verify zero energy before any contact work.",
      "Clamp-meter all three phases at start and running; compare to the **motor nameplate FLA** and check phase balance.",
      "Verify the overload relay/parameter is set to ~115–125 % of FLA, not lower.",
      "Hand-rotate the load (de-energized) for drag; check alignment and bearings.",
      "Check cooling — filters, fans, ambient — if the trip only happens once warm.",
    ].join("\n"),
    tools: "True-RMS clamp ammeter, IR thermometer, insulated hand tools, megohmmeter for winding checks.",
    parts: "Overload relay/heater element sized to FLA; bearings only if drag is confirmed.",
  },
  {
    match: /comm|network|ethernet|loss of comm|f0?81|no connection|offline node/i,
    title: "Loss of communications (network / drive comms)",
    causes: [
      "**Loose or damaged comms cable / connector** — vibration loosens RJ45/DPI connectors; the most common comms-loss root cause.",
      "**Controller or scanner faulted / in program** — if the controlling PLC drops the connection, the device sees comms loss.",
      "**Switch / media / power problem** — a failed port or power-cycled switch breaks the path.",
      "**Failing comms adapter** — device adapter firmware/hardware fault.",
    ].join("\n"),
    checks: [
      "Read the fault buffer/timestamp at the device; note any correlation with vibration or a shift change.",
      "Reseat and inspect the network cable at BOTH ends; test the pairs with a cable tester.",
      "Ping the device IP from a laptop on the same subnet — stable replies = good path.",
      "Confirm the controlling PLC is in RUN with no I/O/connection faults.",
      "If comms is clean but the fault persists, swap/upgrade the comms adapter.",
    ].join("\n"),
    tools: "Cat5e/6 cable tester, laptop with the relevant EtherNet/IP or fieldbus tools, insulated screwdrivers.",
    parts: "Replacement patch cable; comms adapter (verify P/N against the device nameplate).",
  },
];

function detectGuidance(q: string): GuidanceTopic | null {
  return GUIDANCE.find((g) => g.match.test(q)) ?? null;
}

function genericAnswer(q: string): string {
  const topic = detectGuidance(q);
  if (topic) {
    return `## Problem Summary
General guidance for **${topic.title}** — *"${summarizeRequest(q)}"*. This is standard troubleshooting knowledge, **not** from your plant's documents. Upload the wiring/loop drawing, manual, or this asset's history and I'll ground every step in your own records and name the exact terminals and part numbers.

## Most Likely Causes
${topic.causes}

## Recommended Troubleshooting Order
${topic.checks.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n")}

## Required Tools
- ${topic.tools}

## Required Spare Parts
- ${topic.parts}

## Safety Considerations
- Lockout/tagout and verify stored energy (electrical bus, hydraulic/pneumatic pressure, gravity/spring) is discharged before touching wiring or terminals.
- Use PPE appropriate to the task; arc-flash rated for any energized verification.

## Confidence
**Low–Medium** — sound general guidance, but not yet grounded in your documents. Attach the relevant drawing/manual to raise it and pinpoint specifics.

## Sources Used
{{REFS}}`;
  }

  return `## Problem Summary
I don't have enough grounded information yet for *"${summarizeRequest(q)}"* — no uploaded document clearly matched this question. Here is an honest, general starting point; the more you attach, the more specific I get.

## How to Narrow It Down
1. **LOTO and verify zero energy** before any contact work.
2. Capture the exact symptom and any data — fault code, amps, temperature, pressure, the reading on the HMI/keypad.
3. Identify the specific component and its make/model/part number so the right manual and wiring can be found.
4. Inspect the most likely item first and confirm with a measurement that has a clear good/bad threshold — eliminate with evidence, don't swap parts.
5. Verify the fix under load and document what you found.

## Required Tools
- Multimeter (CAT III), clamp ammeter, IR thermometer, basic hand tools.

## Safety Considerations
- Lockout/tagout and verify stored energy (electrical bus, hydraulic/pneumatic pressure, gravity/spring) is discharged.
- Use PPE appropriate to the task; arc-flash rated for any energized verification.

## Confidence
**Low** — upload the relevant manual, drawing, PLC export, or this asset's failure history (or paste the exact fault code) and I'll tailor every step and cite your own records.

## Sources Used
{{REFS}}`;
}

export function buildDemoAnswer(
  question: string,
  ctx: RetrievedChunk[],
  failureContext?: string,
  // The canned, machine-SPECIFIC demo cases (Conveyor 3, Pump 12, …) are curated
  // for the isolated DEMO tenant only. In a real customer org they must NEVER
  // fire — a fabricated "your Conveyor 3 panel filter PF-3" answer would be fake
  // data. Off by default; the chat layer passes true only for org_demo.
  allowCannedCases = false
): string {
  const matched = allowCannedCases ? CASES.find((c) => c.match.test(question)) : undefined;
  // Answer body precedence for the offline engine — ANSWER FIRST, cite second:
  //   1. a curated demo case (isolated demo tenant only), else
  //   2. EXPERT FAULT-CODE answer — a direct "F004 — UnderVoltage" answer parsed
  //      from the OEM fault tables (not a passage dump), else
  //   3. EXTRACTIVE grounding — read the retrieved chunks and quote the passages
  //      that answer the question, else
  //   4. the honest general-guidance fallback (asks for an upload).
  const bodyFor = (q: string): string =>
    matched
      ? matched.build(q)
      : buildFaultCodeAnswer(q, ctx) || buildGroundedFromDocuments(q, ctx) || genericAnswer(q);

  // When the question resolved to the plant's OWN failure records (by asset
  // number, part number, or area), lead with those authoritative facts so the
  // offline answer is grounded in real history rather than a generic template.
  if (failureContext && failureContext.trim()) {
    const body = bodyFor(question);
    const memory = `## Matched Plant Failure Records\nResolved directly from your maintenance records for *"${summarizeRequest(question)}"*:\n\n\`\`\`\n${failureContext.trim()}\n\`\`\`\n\n`;
    return memory + body.replace("{{REFS}}", refs(ctx));
  }
  const body = bodyFor(question);
  return body.replace("{{REFS}}", refs(ctx));
}
