import { db, ensureDb } from "@/lib/db";
import {
  assets,
  documents,
  chunks,
  workOrders,
  workOrderEvents,
  conversations,
  messages,
  technicians,
  alarmEvents,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { chunkText } from "@/lib/rag/chunk";
import { id, DEMO_ORG } from "@/lib/util";
import { CONV3_L5X } from "@/lib/plc/sampleConv3L5X";
import { parseL5X } from "@/lib/plc/parseL5X";
import { savePlcProject, plcSummaryText } from "@/lib/plc/store";

// ─────────────────────────────────────────────────────────────────────────
// Demo seed — the "killer demo".
//
// On first DB use we preload one realistic asset (Conveyor 3) with the exact
// documents a maintenance manager would expect: a PowerFlex 525 manual, the
// conveyor's electrical drawing, prior work orders, and a captured lesson
// learned. This makes the headline workflow — "Conveyor 3 trips after 20
// minutes" → grounded structured answer → Create Work Order / Save as Lesson
// Learned — work the moment the app loads, with zero setup.
//
// Idempotent: keyed on a stable asset id, so it only seeds once.
// ─────────────────────────────────────────────────────────────────────────

const SEED_ASSET_ID = "ast_demo_conveyor3";
const SEED_TECH_ID = "tech_demo_mike";

// Stable ids so re-runs are no-ops and cross-references stay intact.
const DOC_MANUAL = "doc_demo_pf525_manual";
const DOC_DRAWING = "doc_demo_conv3_drawing";
const DOC_WOHIST = "doc_demo_conv3_wohistory";
const DOC_LESSON = "doc_demo_conv3_lesson";
const DOC_L5X = "doc_demo_conv3_l5x";
const PLC_PROJECT_ID = "plc_demo_conv3";

interface SeedDoc {
  id: string;
  filename: string;
  kind: string;
  text: string;
}

const PF525_MANUAL = `Allen-Bradley PowerFlex 525 AC Drive — Maintenance & Fault Reference (Plant Copy)
Drive: PowerFlex 525, 5 HP, 480 VAC, EtherNet/IP embedded. Tag: VFD-CONV3.

FAULT CODE QUICK REFERENCE
F004  UnderVoltage — DC bus below limit. Check incoming supply / sag.
F005  OverVoltage — DC bus too high. Check decel ramp / add dynamic brake resistor.
F007  Motor Overload — drive I2t exceeded. Check load, accel time, OL settings, mechanical drag.
F012  HW OverCurrent — instantaneous overcurrent. Check shorts, motor, output wiring.
F059  Safety Open — safe-torque-off input open. Check gate guard / e-stop string.
F070  Power Unit fault — internal. Cycle power; if persists, replace drive.
F081  Comm Loss (DPI/Network) — drive lost its EtherNet/IP control connection.

F007 MOTOR OVERLOAD — DETAILED
F007 trips when the drive's thermal model (I2t) integrates more current than the
motor can dissipate. On a conveyor this is almost always MECHANICAL LOAD or a
THERMAL effect that grows as the system runs:
  • A drive that runs fine on a cold start and faults F007 after 15-25 minutes is
    a classic thermal/overload signature — current climbs as a bearing, gearbox,
    or motor heats and drag rises, OR the motor's own cooling is impaired.
  • Verify parameter P034 (Motor OL Current) is set to motor FLA, and t093
    (motor overload settings). Do NOT simply raise the OL limit to mask a
    mechanical problem — that burns the motor.
  • Trend output current (drive parameter b003 Output Current) from cold start to
    fault. A steady climb to the OL limit confirms rising mechanical load or a
    failing motor. A sudden spike points to a jam or short.

ACCEL / DECEL
  P041 Accel Time 1, P042 Decel Time 1. Too-fast accel on a heavy conveyor trips
  F007 or F012 at start, not after 20 minutes — so a delayed trip is not an
  accel problem.

THERMAL DERATING
  The 525 derates above 40 °C ambient. A drive in a closed panel with a failed
  cooling fan will heat-soak over ~20 minutes and trip on overload or overtemp.
  Check the drive cooling fan and panel ventilation as part of any "faults after
  it warms up" complaint.

LOTO / SAFETY
  DC bus holds lethal voltage up to 5 minutes after power-off. Verify 0 VDC on
  the bus capacitors before touching drive terminals. Restart can command the
  motor — clear the conveyor first.`;

const CONV3_DRAWING = `Conveyor 3 — Electrical / Power Drawing (Drawing No. E-CONV3-014, Rev C)
AREA: Packaging Line 2.  MOTOR: 5 HP, 480 VAC, 3-phase, FLA 7.6 A, 1750 rpm.
GEARBOX: helical inline, 20:1.  DRIVE: PowerFlex 525 (VFD-CONV3), EtherNet/IP.

POWER PATH
  MCC-2 Bucket 7 → 15 A breaker CB-CONV3 → VFD-CONV3 (PowerFlex 525) → MTR-CONV3.
  Overload protection: drive electronic OL (P034 = 7.6 A) + class 10.

CONTROL
  Run/Stop from PLC (CompactLogix L24, rack PKG2) over EtherNet/IP.
  E-stop string: gate guard GS-3 + pull-cord PC-3 → safety relay → drive STO (F059 if open).

THERMAL NOTES (added Rev C after Mar 2025 events)
  VFD-CONV3 panel has a filtered intake fan PF-3 and exhaust. Panel temp rises
  ~15 °C over ambient under load. If intake filter clogs or fan PF-3 fails, the
  drive heat-soaks within 20-30 min and the motor circuit overloads.

LUBRICATION / MECHANICAL
  Gearbox: ISO VG 220.  Drive-end bearing of MTR-CONV3 had a high-temp note in
  the Apr 2025 PM. Belt take-up at the tail; check tracking and tail bearing.`;

const CONV3_WO_HISTORY = `Conveyor 3 (CONV3 / VFD-CONV3) — Prior Work Order & Failure History
This is the machine's maintenance memory. Most recent first.

WO-100431 | 2025-05-02 | Corrective | Closed
  Symptom: Conveyor 3 trips on drive Fault F007 (motor overload) about 20 minutes
  into a run; restarts fine when cold, faults again once warm.
  Found: VFD panel intake filter PF-3 ~80% clogged; panel running hot (58 °C).
  Drive output current climbed from 6.1 A cold to OL limit as panel heat-soaked.
  Fix: Replaced intake filter, cleaned exhaust, confirmed fan PF-3. Output
  current held 6.2-6.6 A for a full hour. Closed.
  Tech: Mike R.  Labor: 42 min.  Downtime: ~1 hr.

WO-100388 | 2025-04-15 | Preventive | Closed
  Quarterly PM. Greased MTR-CONV3 bearings, checked belt tracking/take-up.
  NOTE: drive-end motor bearing running warm (logged for trend). Gearbox oil ok.
  Tech: Dana P.  Labor: 35 min.

WO-100201 | 2025-03-08 | Corrective | Closed
  Symptom: F007 overload after ~25 min. Found belt mistracking, rubbing frame —
  added drag that grew as belt warmed/stretched. Re-tracked belt, adjusted
  take-up. Resolved.
  Tech: Mike R.  Labor: 55 min.  Downtime: ~1.5 hr.

PATTERN: Conveyor 3's "F007 / overload after it warms up" complaint has recurred
three times. Two root causes seen: (1) VFD panel cooling (clogged filter / hot
panel) and (2) mechanical drag (belt mistracking, warm motor bearing). Cold
start is always fine; the fault appears only after ~20 minutes of run time.`;

const CONV3_LESSON = `LESSON LEARNED — Conveyor 3: "trips ~20 minutes into a run" (F007 overload)
Captured from resolved work orders WO-100201, WO-100431.

WHAT WE LEARNED
  A delayed overload trip (fine cold, faults after ~20 min) on Conveyor 3 is a
  THERMAL or PROGRESSIVE-MECHANICAL problem, never an accel-time problem. The two
  proven root causes on this exact machine:
    1. VFD-CONV3 panel cooling — clogged intake filter PF-3 / failed fan → drive
       heat-soaks → motor overload model (F007) trips (WO-100431).
    2. Mechanical drag that grows with temperature — belt mistracking or a warm
       motor bearing raising running current over time (WO-100201).

FASTEST PATH TO RESOLUTION (proven ~42 min by Mike R.)
  • Trend drive output current (b003) from cold start to the trip. Steady climb =
    thermal/mechanical; sudden spike = jam/short.
  • Check VFD panel temperature and intake filter PF-3 FIRST — cheapest, most
    common cause here.
  • Then verify belt tracking/take-up and motor drive-end bearing temperature.
  • Do NOT raise the drive overload limit (P034) to make it stop — that masks the
    real fault and risks the motor.

PM RECOMMENDATION
  Add a monthly VFD panel filter check for Conveyor 3 (was only on quarterly PM).
  Trend the motor drive-end bearing temperature — it has been logged warm twice.`;

const SEED_DOCS: SeedDoc[] = [
  { id: DOC_MANUAL, filename: "PowerFlex 525 Manual.pdf", kind: "manual", text: PF525_MANUAL },
  { id: DOC_DRAWING, filename: "Conveyor 3 Electrical Drawing E-CONV3-014.pdf", kind: "drawing", text: CONV3_DRAWING },
  { id: DOC_WOHIST, filename: "Conveyor 3 Work Order History.txt", kind: "document", text: CONV3_WO_HISTORY },
  { id: DOC_LESSON, filename: "Lesson Learned — Conveyor 3 F007.md", kind: "sop", text: CONV3_LESSON },
];

interface SeedWO {
  id: string;
  number: string;
  title: string;
  description: string;
  symptom?: string;
  resolution?: string;
  status: string;
  priority: string;
  type: string;
  createdAt: number;
  // Minutes from report → restored, for closed corrective WOs (true downtime).
  downtimeMins?: number;
  assignedTo?: string;
}

const DAY = 86400_000;
const now = Date.now();

const SEED_WORKORDERS: SeedWO[] = [
  {
    // A LIVE open work order so the daily-loop UI is populated on first load.
    id: "wo_demo_open",
    number: "WO-100502",
    title: "Conveyor 3 — F007 overload again ~20 min into run",
    symptom:
      "Conveyor 3 tripped on drive Fault F007 about 20 minutes into the morning run. Restarted and it ran, faulted again once warm. Same pattern as before.",
    description: "Reported by line operator at shift start. Recurring F007 thermal/overload signature.",
    status: "open",
    priority: "high",
    type: "corrective",
    assignedTo: "Mike R.",
    createdAt: now - 2 * 3600_000, // 2 hours ago
  },
  {
    id: "wo_demo_100431",
    number: "WO-100431",
    title: "Conveyor 3 — F007 overload ~20 min into run",
    symptom:
      "Drive Fault F007 (motor overload) ~20 min into a run; fine when cold, faults again once warm.",
    resolution:
      "Found VFD panel intake filter clogged and panel running hot; output current climbed to the overload limit as it heat-soaked. Replaced the panel filter, cleaned the exhaust. Verified current held steady to temperature for an hour.",
    description:
      "Drive Fault F007 (motor overload) ~20 min into a run; fine when cold. Found VFD panel intake filter clogged, panel hot; output current climbed to OL limit. Replaced filter, cleaned exhaust. Held normal current for an hour.",
    status: "done",
    priority: "high",
    type: "corrective",
    downtimeMins: 48,
    createdAt: now - 57 * DAY,
  },
  {
    id: "wo_demo_100388",
    number: "WO-100388",
    title: "Conveyor 3 — Quarterly PM",
    resolution:
      "Greased MTR-CONV3 bearings, checked belt tracking/take-up. Drive-end motor bearing running warm — logged for trend. Gearbox oil OK.",
    description:
      "Greased MTR-CONV3 bearings, checked belt tracking/take-up. Drive-end motor bearing running warm — logged for trend. Gearbox oil OK.",
    status: "done",
    priority: "medium",
    type: "preventive",
    downtimeMins: 35,
    createdAt: now - 74 * DAY,
  },
  {
    id: "wo_demo_100201",
    number: "WO-100201",
    title: "Conveyor 3 — F007 overload after ~25 min",
    symptom: "F007 overload after ~25 minutes of running.",
    resolution:
      "Found belt mistracking rubbing the frame, adding drag that grew as the belt warmed. Re-tracked the belt and adjusted take-up. Resolved.",
    description:
      "F007 overload after ~25 min. Found belt mistracking rubbing the frame, adding drag that grew as the belt warmed. Re-tracked belt, adjusted take-up. Resolved.",
    status: "done",
    priority: "high",
    type: "corrective",
    downtimeMins: 61,
    createdAt: now - 112 * DAY,
  },
];

async function alreadySeeded(): Promise<boolean> {
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.orgId, DEMO_ORG), eq(assets.id, SEED_ASSET_ID)));
  return rows.length > 0;
}

export async function seedDemo(): Promise<void> {
  await ensureDb();
  if (await alreadySeeded()) return;

  // 1) The asset — Conveyor 3 (rich digital-twin nameplate + location).
  await db.insert(assets).values({
    id: SEED_ASSET_ID,
    orgId: DEMO_ORG,
    name: "Conveyor 3",
    assetTag: "CONV3 / VFD-CONV3",
    site: "Plant A",
    area: "Packaging",
    line: "Line 2",
    cell: "Takeaway",
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
    serialNumber: "1P5C25A103",
    assetType: "drive",
    status: "operational",
    criticality: "high",
    installedAt: new Date("2019-01-15"),
    notes:
      "Packaging Line 2 takeaway conveyor. PowerFlex 525 drive (VFD-CONV3, 5 HP, 480 V) on EtherNet/IP. Known history of F007 overload trips ~20 minutes into a run.",
  });

  // 1b) Two more assets so the equipment list reflects a real plant floor.
  await db.insert(assets).values([
    {
      id: "ast_demo_pump12",
      orgId: DEMO_ORG,
      name: "Pump 12",
      assetTag: "P-12",
      site: "Plant A",
      area: "Utilities",
      line: "Boiler House",
      cell: "Skid 2",
      manufacturer: "Grundfos",
      model: "CR 15-3",
      serialNumber: "GF15-3-77120",
      assetType: "pump",
      status: "degraded",
      criticality: "medium",
      installedAt: new Date("2020-06-01"),
      notes: "Boiler feed pump. Seal weep logged on last inspection — watch for vibration.",
    },
    {
      id: "ast_demo_conveyor1",
      orgId: DEMO_ORG,
      name: "Conveyor 1",
      assetTag: "CONV1",
      site: "Plant A",
      area: "Packaging",
      line: "Line 1",
      cell: "Infeed",
      manufacturer: "Allen-Bradley",
      model: "PowerFlex 525",
      serialNumber: "1P5C25A088",
      assetType: "conveyor",
      status: "operational",
      criticality: "low",
      installedAt: new Date("2018-09-20"),
      notes: "Line 1 infeed conveyor. No recent faults.",
    },
  ]);

  // 2) A technician for the memory layer (Mike R.).
  await db.insert(technicians).values({
    id: SEED_TECH_ID,
    orgId: DEMO_ORG,
    name: "Mike R.",
    email: "mike.r@plant.local",
    role: "technician",
    level: "senior",
    certifications: JSON.stringify(["Allen-Bradley VFD", "Arc Flash", "LOTO"]),
    notes: "Resolved the recurring Conveyor 3 F007 overload in 42 minutes.",
  });

  // 3) Documents + retrievable chunks, all scoped to the asset.
  for (const d of SEED_DOCS) {
    await db.insert(documents).values({
      id: d.id,
      orgId: DEMO_ORG,
      assetId: SEED_ASSET_ID,
      filename: d.filename,
      kind: d.kind,
      mimeType: d.filename.endsWith(".pdf")
        ? "application/pdf"
        : d.filename.endsWith(".md")
        ? "text/markdown"
        : "text/plain",
      sizeBytes: d.text.length,
      storagePath: null,
      charCount: d.text.length,
    });
    const pieces = chunkText(d.text);
    let ord = 0;
    for (const piece of pieces) {
      await db.insert(chunks).values({
        id: id("chk"),
        orgId: DEMO_ORG,
        documentId: d.id,
        assetId: SEED_ASSET_ID,
        ordinal: ord++,
        content: piece,
      });
    }
  }

  // 4) Prior work orders (the machine's failure history) + a live open one.
  //    We also seed the lifecycle history timeline so the detail page and KPIs
  //    are populated on first load.
  for (const w of SEED_WORKORDERS) {
    const reported = new Date(w.createdAt);
    const closed =
      w.status === "done" && w.downtimeMins
        ? new Date(w.createdAt + w.downtimeMins * 60_000)
        : null;
    const started =
      w.status === "done" && w.downtimeMins
        ? new Date(w.createdAt + Math.round(w.downtimeMins * 0.2) * 60_000)
        : null;
    await db.insert(workOrders).values({
      id: w.id,
      orgId: DEMO_ORG,
      assetId: SEED_ASSET_ID,
      number: w.number,
      title: w.title,
      description: w.description,
      symptom: w.symptom ?? null,
      resolution: w.resolution ?? null,
      priority: w.priority,
      status: w.status,
      type: w.type,
      assignedTo: w.assignedTo ?? (w.title.includes("PM") ? "Dana P." : "Mike R."),
      estLaborMins: w.number === "WO-100431" ? 42 : w.number === "WO-100201" ? 55 : 35,
      reportedAt: reported,
      startedAt: started,
      closedAt: closed,
      downtimeMins: w.status === "done" ? w.downtimeMins ?? null : null,
      source: "eas",
      createdAt: reported,
      updatedAt: closed ?? reported,
    });

    // History timeline events.
    const actor = w.assignedTo ?? "Mike R.";
    await db.insert(workOrderEvents).values({
      id: id("woe"),
      orgId: DEMO_ORG,
      workOrderId: w.id,
      kind: "created",
      toStatus: "open",
      note: w.symptom ?? w.title,
      actor,
      at: reported,
    });
    if (started) {
      await db.insert(workOrderEvents).values({
        id: id("woe"),
        orgId: DEMO_ORG,
        workOrderId: w.id,
        kind: "status",
        fromStatus: "open",
        toStatus: "in_progress",
        actor,
        at: started,
      });
    }
    if (closed) {
      await db.insert(workOrderEvents).values({
        id: id("woe"),
        orgId: DEMO_ORG,
        workOrderId: w.id,
        kind: "status",
        fromStatus: "in_progress",
        toStatus: "done",
        note: "Closed out",
        actor,
        at: closed,
      });
    }
  }

  // 4b) The PLC project — parse the realistic Conveyor 3 L5X through the real
  //     parser so the Explorer is populated on first load, and register it as a
  //     retrievable document scoped to the asset.
  try {
    const { ir } = parseL5X(CONV3_L5X);
    const l5xText = plcSummaryText(ir, "Conveyor3_PKG2.L5X");
    await db.insert(documents).values({
      id: DOC_L5X,
      orgId: DEMO_ORG,
      assetId: SEED_ASSET_ID,
      filename: "Conveyor3_PKG2.L5X",
      kind: "plc",
      mimeType: "application/xml",
      sizeBytes: CONV3_L5X.length,
      storagePath: null,
      charCount: CONV3_L5X.length,
    });
    let pord = 0;
    for (const piece of chunkText(l5xText)) {
      await db.insert(chunks).values({
        id: id("chk"),
        orgId: DEMO_ORG,
        documentId: DOC_L5X,
        assetId: SEED_ASSET_ID,
        ordinal: pord++,
        content: piece,
      });
    }
    await savePlcProject(DEMO_ORG, {
      documentId: DOC_L5X,
      assetId: SEED_ASSET_ID,
      filename: "Conveyor3_PKG2.L5X",
      ir,
      fixedId: PLC_PROJECT_ID,
    });
  } catch (err) {
    console.error("[seed] PLC project seed failed:", err);
  }

  // 4c) Alarm / fault history feeding the digital-twin reliability metrics.
  const SEED_ALARMS = [
    { code: "F007", message: "Motor Overload — drive I2t exceeded ~20 min into run", severity: "fault", asset: SEED_ASSET_ID, daysAgo: 57 },
    { code: "F007", message: "Motor Overload after ~25 min — belt mistracking drag", severity: "fault", asset: SEED_ASSET_ID, daysAgo: 112 },
    { code: "F081", message: "Comm Loss (DPI/Network) — momentary EtherNet/IP drop", severity: "warning", asset: SEED_ASSET_ID, daysAgo: 33 },
    { code: "F012", message: "HW OverCurrent transient at start", severity: "warning", asset: SEED_ASSET_ID, daysAgo: 140 },
    { code: null, message: "Seal weep observed on inspection round", severity: "warning", asset: "ast_demo_pump12", daysAgo: 12 },
  ];
  for (const a of SEED_ALARMS) {
    await db.insert(alarmEvents).values({
      id: id("alm"),
      orgId: DEMO_ORG,
      assetId: a.asset,
      code: a.code,
      message: a.message,
      severity: a.severity,
      source: "alarm_log",
      occurredAt: new Date(now - a.daysAgo * DAY),
    });
  }

  // 5) A prior troubleshooting session so "Recent Sessions" is populated and the
  //    asset shows living history.
  const convId = "cnv_demo_conv3_history";
  await db.insert(conversations).values({
    id: convId,
    orgId: DEMO_ORG,
    assetId: SEED_ASSET_ID,
    title: "Conveyor 3 keeps tripping after it warms up",
    createdAt: new Date(now - 57 * DAY),
    updatedAt: new Date(now - 57 * DAY),
  });
  await db.insert(messages).values({
    id: id("msg"),
    orgId: DEMO_ORG,
    conversationId: convId,
    role: "user",
    content: "Conveyor 3 trips on F007 about 20 minutes into a run but is fine when cold. What should I check?",
    createdAt: new Date(now - 57 * DAY),
  });
  await db.insert(messages).values({
    id: id("msg"),
    orgId: DEMO_ORG,
    conversationId: convId,
    role: "assistant",
    content:
      "A delayed F007 overload on Conveyor 3 is a thermal/progressive-mechanical issue, not an accel problem. Check the VFD panel cooling (intake filter PF-3) first, then belt tracking and the motor drive-end bearing. Trend drive output current from cold start to the trip.",
    meta: JSON.stringify({
      live: false,
      sources: [
        { filename: "Conveyor 3 Work Order History.txt", kind: "document" },
        { filename: "PowerFlex 525 Manual.pdf", kind: "manual" },
      ],
    }),
    createdAt: new Date(now - 57 * DAY),
  });
}

export const DEMO_SEED = {
  assetId: SEED_ASSET_ID,
  assetName: "Conveyor 3",
};
