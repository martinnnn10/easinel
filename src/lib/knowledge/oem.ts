// ─────────────────────────────────────────────────────────────────────────
// Pre-seeded OEM knowledge (Decision 4: Time-to-value).
//
// The cold-start problem for any maintenance copilot is brutal: a brand-new
// account has uploaded nothing, so the AI knows nothing, so the technician never
// comes back. We solve it by shipping a curated library of GENERIC, vendor-class
// fault references for the most common industrial equipment a North American
// plant runs. These are seeded as ORG-GLOBAL documents (assetId = null) so they
// are retrievable on day one, before the customer uploads a single manual.
//
// Provenance & honesty (Constitution: Explainability, Brutal Honesty):
//   • This content is a curated, plant-generic distillation of publicly
//     documented fault behavior for common equipment classes. It is labeled
//     kind="oem_reference" and surfaced to the technician AS a general reference,
//     never as if it were their specific machine's manual.
//   • It is intentionally conservative and points the technician at the OEM
//     manual + LOTO for anything safety-critical. It never tells anyone to
//     bypass a safety device.
//
// These are stored as normal documents+chunks (same retrieval pipeline), so when
// the customer later uploads their own PowerFlex manual, their asset-scoped doc
// out-ranks this generic reference automatically (asset affinity boost).
// ─────────────────────────────────────────────────────────────────────────

import { db, ensureDb } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { chunkText } from "@/lib/rag/chunk";
import { id, GLOBAL_ORG } from "@/lib/util";
import { getEmbeddingProvider } from "@/lib/embeddings";

export interface OemDoc {
  id: string;
  title: string;
  /** Equipment class this reference applies to, shown to the technician. */
  equipmentClass: string;
  text: string;
}

export const OEM_KNOWLEDGE: OemDoc[] = [
  {
    id: "oem_pf525_faults",
    title: "Allen-Bradley PowerFlex 525 — Common Fault Reference (General)",
    equipmentClass: "VFD / AC drive (Allen-Bradley PowerFlex 525/523)",
    text: `Allen-Bradley PowerFlex 525 AC Drive — General Fault Reference
This is a generic, plant-agnostic reference for common PowerFlex 525/523 faults.
Always confirm against your drive's own manual and follow LOTO before servicing.

COMMON FAULT CODES
F004 UnderVoltage — DC bus below limit. Check incoming supply, voltage sags, loose input wiring.
F005 OverVoltage — DC bus too high. Usually a too-fast decel ramp; lengthen decel time or add a dynamic brake resistor.
F007 Motor Overload — drive I2t thermal model exceeded. Mechanical drag, undersized accel time, wrong overload setting (P034 = motor FLA), or impaired motor cooling.
F012 HW OverCurrent — instantaneous overcurrent. Check for output short, failing motor, or wiring fault.
F013 Ground Fault — current to ground. Megger the motor and output cable.
F059 Safe Torque Off — STO input open. Check the e-stop / gate-guard safety string.
F070 Power Unit Fault — internal hardware. Cycle power; if it persists, the drive likely needs replacement.
F081 Comm Loss — drive lost its network (EtherNet/IP DPI) control connection. Check the cable, switch port, and IP/connection config.

READING A "FAULTS AFTER IT WARMS UP" COMPLAINT
A drive that runs fine cold and faults F007 after 15–25 minutes is a classic
THERMAL / progressive-mechanical signature — current rises as something heats
(panel cooling fault, motor bearing, gearbox drag). Trend output current from a
cold start to the trip: a steady climb = thermal/mechanical; a sudden spike =
jam or short. Do NOT raise the overload limit (P034) to mask it — that burns the motor.

SAFETY
The DC bus holds lethal voltage for up to 5 minutes after power-off. Verify 0 VDC
before touching terminals. Never defeat the STO / safety string to clear F059.`,
  },
  {
    id: "oem_centrifugal_pump",
    title: "Centrifugal Pump — Common Failure Reference (General)",
    equipmentClass: "Centrifugal pump (e.g. Grundfos CR, Goulds, etc.)",
    text: `Centrifugal Pump — General Troubleshooting Reference
Generic, plant-agnostic. Confirm against the pump/seal manual; follow LOTO.

NO FLOW / LOW FLOW
• Pump not primed, suction air leak, clogged strainer, closed/throttled valve.
• Wrong rotation (check motor phasing after any electrical work).
• Worn impeller or wear rings (gradual head/flow loss over months).

SEAL LEAK / WEEPING
• A weeping mechanical seal that worsens with vibration usually means the seal
  faces are wearing or the shaft is running off-true. Track it — a slow weep
  becomes a failure. Check coupling alignment and bearing condition.

VIBRATION / NOISE
• Cavitation (low NPSH available): rattling "gravel" noise, fluctuating discharge
  pressure. Check suction conditions, strainer, and that you're not running far
  off the best-efficiency point.
• Misalignment / bearing wear: steady vibration that grows over time. Laser-align
  the coupling; trend bearing temperature.

OVERHEATING / MOTOR TRIP
• Running against a closed discharge ("deadheading") overheats the pump quickly.
• Bearing failure or misalignment raises motor current and can trip overloads.`,
  },
  {
    id: "oem_gearbox",
    title: "Industrial Gear Reducer — Common Failure Reference (General)",
    equipmentClass: "Helical/inline gear reducer (gearbox)",
    text: `Industrial Gear Reducer (Gearbox) — General Reference
Generic, plant-agnostic. Follow LOTO and the OEM lubrication spec.

OVERHEATING
• Low oil level, wrong oil grade/viscosity, or oil past its service life.
• Overload / overspeed beyond rating. Blocked breather causing pressure.
• A gearbox that runs hot and adds drag can raise the driving motor's current and
  trip a downstream VFD on overload after it warms up.

NOISE / VIBRATION
• Whine that changes with load = gear mesh/tooth wear. Grinding = bearing failure.
• Check backlash, look for metal in the oil (cut an oil sample), inspect breather.

LEAKS
• Seal or gasket wear; over-filling; blocked breather raising internal pressure.
  Fix the breather first — many "leaks" are really pressurization pushing oil out.`,
  },
  {
    id: "oem_vfd_general",
    title: "VFD / AC Drive — General Diagnostic Approach (Any Brand)",
    equipmentClass: "Variable frequency drive (general)",
    text: `Variable Frequency Drive — General Diagnostic Approach (brand-agnostic)
For ABB, Siemens, Yaskawa, Danfoss, Allen-Bradley, etc. Use the drive's own
fault list for exact codes; this is the universal method. Follow LOTO; the DC bus
stays charged after power-off.

THE FOUR QUESTIONS FOR ANY DRIVE FAULT
1. Does it fault on a COLD start, or only after RUNNING a while?
   — Cold-start fault → wiring, parameter, sizing, or mechanical bind.
   — After warm-up → thermal: drive panel cooling, motor cooling, or growing
     mechanical drag (bearing/belt/gearbox).
2. Is the fault OVERCURRENT or OVERLOAD?
   — Overcurrent (instant) → short, ground fault, failing motor, output wiring.
   — Overload (I2t, builds over time) → mechanical load or wrong overload setting.
3. Is it a VOLTAGE fault? Under = supply/wiring; Over = decel ramp too fast.
4. Is it a COMM / network fault? Check cable, switch port, and configuration.

GOLDEN RULE
Never raise the overload limit to make a fault stop. It masks a real mechanical
or thermal problem and risks the motor. Find the cause.`,
  },
  {
    id: "oem_motor_general",
    title: "AC Induction Motor — Common Failure Reference (General)",
    equipmentClass: "AC induction motor (general)",
    text: `AC Induction Motor — General Troubleshooting Reference
Generic, plant-agnostic. Follow LOTO; verify zero energy before touching leads.

WON'T START / HUMS
• Single-phasing (lost one phase) — check fuses, contactor, supply.
• Locked rotor / mechanical bind on the driven load.
• Failed start capacitor (single-phase motors).

OVERHEATING / TRIPS OVERLOAD
• Overload on the driven equipment, high ambient, blocked cooling fan/fins.
• Voltage imbalance between phases (>1% imbalance causes large temperature rise).
• Worn bearings raising friction and current.

VIBRATION / NOISE
• Bearing wear (most common): trend temperature and vibration; replace before failure.
• Misalignment or imbalance; soft foot at the base.
• Electrical: a steady 2× line-frequency vibration can indicate rotor/stator issues.`,
  },
  {
    id: "oem_plc_controller",
    title: "Programmable Controller (PLC) — Common Fault Reference (General)",
    equipmentClass: "PLC / PAC (Allen-Bradley CompactLogix/ControlLogix, Siemens S7, etc.)",
    text: `Programmable Controller (PLC) — General Fault Reference
Generic, plant-agnostic. NEVER force outputs or download logic to a running
machine without authorization and LOTO of the affected actuators.

CONTROLLER STATUS LEDS
• Solid red / faulted controller — a MAJOR fault halted the processor. Read the
  fault code from the controller (e.g. Logix major fault type/code) BEFORE
  clearing; clearing without understanding loses the cause. Common: array index
  out of range, watchdog timeout, or a corrupted/absent program after power loss.
• Flashing red — recoverable fault or no project loaded.
• I/O LED red / flashing — a module or rack lost communication (see below).

I/O & NETWORK FAULTS
• A module showing comm loss is usually wiring, a failed module, a power dip on
  the rack, or a duplicate/changed IP. Check the cable, the switch port, and that
  no one changed addressing. EtherNet/IP "connection timed out" mirrors a drive's
  F081-class comm fault — same root causes.
• Intermittent I/O faults after the panel warms up point at a loose terminal or a
  failing module, not the program.

MEMORY / BATTERY / POWER
• A controller that loses its program on power cycle has a dead memory battery or
  energy module (older platforms) — replace it; back up the program first.
• Random halts can be a marginal 24 VDC supply. Measure it under load.

GOLDEN RULE
Logic almost never "goes bad" on its own. A machine that ran for years and now
faults changed in the physical world first — a sensor, a wire, a module, a supply.
Suspect the field before the program.`,
  },
  {
    id: "oem_photoeye_sensor",
    title: "Photoelectric / Proximity Sensor — Common Failure Reference (General)",
    equipmentClass: "Photoeye, proximity, and discrete sensors (general)",
    text: `Discrete Sensor (Photoeye / Proximity) — General Troubleshooting Reference
Generic, plant-agnostic. Follow LOTO before reaching into a machine to inspect a sensor.

NOT DETECTING / NOT SWITCHING
• Lens fouled by dust, coolant, or product film — the #1 cause of "random" misses.
  Clean it first. A photoeye that works after a wipe was never broken.
• Misalignment of emitter/receiver or retro-reflector (vibration walked it off).
• Sensing distance / target out of range, wrong target material (proximity sensors
  see metal differently; aluminum/stainless reduce range vs. mild steel).
• Output wiring: PNP vs NPN mismatch to the input card, or a broken/chafed cable.

ALWAYS ON / ALWAYS OFF
• Shorted or pinched cable, water ingress in the connector (check the M12 boot).
• Background reflection tripping a non-polarized photoeye — use a polarized/retro
  or background-suppression sensor.
• Failed output transistor — confirm with a meter at the sensor before replacing logic.

INTERMITTENT
• Marginal alignment plus machine vibration; condensation; a connector backing out.
  Intermittent sensor faults masquerade as PLC or drive problems — verify the
  signal at the input card LED before chasing the controller.`,
  },
  {
    id: "oem_pneumatic_valve",
    title: "Pneumatic System / Solenoid Valve — Common Failure Reference (General)",
    equipmentClass: "Pneumatic cylinders, solenoid valves, FRL (general)",
    text: `Pneumatic System — General Troubleshooting Reference
Generic, plant-agnostic. RELIEVE STORED AIR PRESSURE and follow LOTO before
servicing — a charged cylinder or accumulator can move with lethal force.

CYLINDER WON'T MOVE / WEAK / SLOW
• Low supply pressure or a throttled/closed shutoff — check the gauge at the FRL.
• Clogged filter or a drained-dry lubricator (where used); water in the bowl.
• Flow control backed off, or a kinked/blocked line.
• Worn cylinder seals (blow-by) — air escapes past the piston; the rod creeps or
  loses force. A cylinder that weakens over weeks is usually seal wear.

VALVE NOT SHIFTING
• Solenoid coil not energized — verify voltage AT the coil (could be a blown coil,
  broken wire, or the PLC output never fired). Manual override on the valve will
  confirm the mechanical side is free.
• Contamination jamming the spool, or no pilot pressure (low-pressure pilot valves
  need a minimum supply to shift).

AIR LEAKS / NOISE
• Continuous hiss = a seal, fitting, or a stuck-open valve venting. Leaks waste
  energy and drop system pressure for everything downstream — fix them.
• Water/oil in the air = failed dryer or a full FRL bowl; it destroys valves and
  seals over time.`,
  },
  {
    id: "oem_conveyor",
    title: "Conveyor (Belt / Roller / Chain) — Common Failure Reference (General)",
    equipmentClass: "Belt, roller, and chain conveyors (general)",
    text: `Conveyor — General Troubleshooting Reference
Generic, plant-agnostic. LOTO the drive AND guard against gravity/stored energy on
inclines before clearing a jam or reaching into a nip point.

BELT TRACKING / MISTRACKING
• Belt drifting to one side: check for off-square pulleys, uneven tension, material
  buildup on a pulley/roller, or a frame that's out of level. Adjust tracking in
  small steps and run between adjustments.

SLIPPING / NOT MOVING
• Glazed or worn drive lagging, low belt tension, or an overloaded belt.
• On chain conveyors: stretched/worn chain, seized roller, or a broken link.
• Drive faulted upstream (motor/gearbox/VFD) — confirm the drive is actually
  commanding motion before blaming the belt.

NOISE / VIBRATION
• Seized idler/roller bearing (find the hot or squealing roller), or material
  packed around a shaft. A dragging roller raises motor current and can trip the
  drive on overload after it warms up.

JAMS / SAFETY
• Recurring jams at a transfer usually mean a worn/misadjusted transfer plate or a
  product-flow issue, not the conveyor itself. Never clear a jam on a live machine
  — pull-cords and e-stops exist because reaching into a running conveyor kills.`,
  },
  {
    id: "oem_safety_circuit",
    title: "Machine Safety Circuit (E-Stop / Light Curtain / Safety Relay) — Reference (General)",
    equipmentClass: "Safety relays, e-stops, light curtains, gate interlocks (general)",
    text: `Machine Safety Circuit — General Reference
Generic, plant-agnostic. Safety devices exist to protect people. NEVER bypass,
jumper, or defeat a safety device to "get the line running." Diagnose and fix it.

MACHINE WON'T START / SAFETY RELAY WON'T RESET
• An OPEN device somewhere in the safety string: a popped e-stop, an open gate
  interlock, a blocked/misaligned light curtain, or a tripped pull-cord. Walk the
  string and find the open contact — the safety relay only resets when every device
  in the chain is closed and healthy.
• Dual-channel fault: safety relays monitor two redundant channels and will LOCK
  OUT if the channels disagree (one contact welded/stuck, or a cross-fault in
  wiring). This is the device doing its job — find the failed contact or wiring fault.
• Reset sequence: many circuits require the device to close AND a separate monitored
  reset pulse. A held/stuck reset button is itself a fault on most modern relays.

LIGHT CURTAIN FAULTS
• Misalignment, a fouled lens, or something parked in the field. Blanking/muting
  must be configured correctly — an incorrectly muted curtain is a safety hazard,
  not a fix.

RULE
If a safety device keeps tripping, that is a SYMPTOM. The correct response is to
find what is opening it (mechanical interference, a failing switch, a wiring fault)
— never to defeat it.`,
  },
];

const OEM_VERSION = 2;

// Has a SPECIFIC OEM doc already been seeded for this org?
async function docSeeded(docId: string): Promise<boolean> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.orgId, GLOBAL_ORG), eq(documents.id, docId)));
  return rows.length > 0;
}

// Seed the OEM reference library as org-global (assetId = null) documents +
// retrievable chunks. Called from the DB bootstrap so day-one value exists with
// zero customer setup.
//
// Idempotency is PER-DOCUMENT, not keyed on the first doc. This is deliberate:
// the bootstrap may seed during the same init in which the first reference was
// just inserted, or a prior run may have been interrupted partway. A first-doc
// guard would then permanently skip references 2..N (a real day-one knowledge
// gap). Checking each document independently makes the seed self-healing — every
// missing reference is (re)inserted on the next call, and existing ones are left
// untouched.
export async function seedOemKnowledge(): Promise<void> {
  await ensureDb();

  for (const doc of OEM_KNOWLEDGE) {
    if (await docSeeded(doc.id)) continue; // this reference already present
    // Idempotent insert: onConflictDoNothing closes the check-then-act gap so a
    // concurrent or re-entrant bootstrap can never raise a PRIMARY KEY error.
    await db
      .insert(documents)
      .values({
        id: doc.id,
        orgId: GLOBAL_ORG,
        assetId: null, // GLOBAL — applies to any matching equipment, not one asset
        filename: `${doc.title}.md`,
        kind: "oem_reference",
        mimeType: "text/markdown",
        sizeBytes: doc.text.length,
        storagePath: null,
        charCount: doc.text.length,
      })
      .onConflictDoNothing();
    const pieces = chunkText(doc.text);
    // Embed the global knowledge so the hybrid retriever has vectors for the
    // shared library too. Non-fatal on failure (lexical retrieval still works).
    let vectors: (number[] | null)[] = pieces.map(() => null);
    try {
      const results = await getEmbeddingProvider().embedBatch(pieces);
      vectors = results.map((r) => r.vector);
    } catch {
      /* keep nulls; lexical retrieval covers it */
    }
    let ord = 0;
    for (let i = 0; i < pieces.length; i++) {
      await db
        .insert(chunks)
        .values({
          id: `chk_${doc.id}_${ord}`,
          orgId: GLOBAL_ORG,
          documentId: doc.id,
          assetId: null,
          ordinal: ord++,
          content: pieces[i],
          embedding: vectors[i] ? JSON.stringify(vectors[i]) : null,
        })
        .onConflictDoNothing();
    }
  }
}

export const OEM_KNOWLEDGE_META = {
  version: OEM_VERSION,
  count: OEM_KNOWLEDGE.length,
};
