import type { RetrievedChunk } from "@/lib/rag/retrieve";

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

function genericAnswer(q: string): string {
  return `## Problem Summary
Here is a structured first-pass on: *"${summarizeRequest(q)}"*. This answer reasons from general industrial knowledge and any matching plant documents; once your manuals, drawings, and work-order history are uploaded, every step is grounded in this plant's own records.

## Most Likely Causes
| Cause | Probability | Why |
|---|---|---|
| Most likely failure mode for this symptom | 40% | Based on typical failure patterns for this equipment class |
| Secondary contributing factor | 30% | Common co-occurring condition |
| Less common but high-impact cause | 20% | Worth ruling out early given downtime cost |
| Environmental / process input | 10% | Upstream condition that can mimic a machine fault |

## Recommended Troubleshooting Order
1. LOTO and verify zero energy before any contact work.
2. Reproduce/observe the symptom and capture data (amps, temps, pressures, fault codes).
3. Inspect the highest-probability item first; confirm with a measurement that has a clear good/bad threshold.
4. Work down the cause list, eliminating with evidence rather than swapping parts.
5. Verify the fix under load and document what you found.

## Required Tools
- Multimeter (CAT III), clamp ammeter, IR thermometer, basic hand tools.

## Required Spare Parts
- Determine after diagnosis; verify part numbers against the manual/BOM.

## Safety Considerations
- Lockout/tagout and verify stored energy (electrical bus, hydraulic/pneumatic pressure, gravity/spring) is discharged.
- Use PPE appropriate to the task; arc-flash rated for any energized verification.

## Estimated Repair Time
30–90 minutes for a qualified tech once the cause is confirmed.

## Confidence
**Low** — upload the relevant manual, drawing, PLC export, or this asset's failure history and I'll tailor every step and raise confidence.

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
  // When the question resolved to the plant's OWN failure records (by asset
  // number, part number, or area), lead with those authoritative facts so the
  // offline answer is grounded in real history rather than a generic template.
  if (failureContext && failureContext.trim()) {
    const body = matched ? matched.build(question) : genericAnswer(question);
    const memory = `## Matched Plant Failure Records\nResolved directly from your maintenance records for *"${summarizeRequest(question)}"*:\n\n\`\`\`\n${failureContext.trim()}\n\`\`\`\n\n`;
    return memory + body.replace("{{REFS}}", refs(ctx));
  }
  const body = matched ? matched.build(question) : genericAnswer(question);
  return body.replace("{{REFS}}", refs(ctx));
}
