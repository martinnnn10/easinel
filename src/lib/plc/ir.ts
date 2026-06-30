// ─────────────────────────────────────────────────────────────────────────
// PLC Intermediate Representation (IR)
//
// A vendor-neutral, serializable model of a PLC project that the Knowledge
// Explorer renders and the AI reasons over. The L5X parser populates this from
// Rockwell Studio 5000 / RSLogix exports. The same IR could later be populated
// from Siemens, .ACD conversion, etc., so the UI never needs to know the source.
//
// Everything here is plain JSON (no class instances) so it round-trips through
// the database `plc_projects.ir` column and the HTTP API unchanged.
// ─────────────────────────────────────────────────────────────────────────

export type PlcSource = "l5x" | "acd" | "unknown";

/** What level of detail the parse achieved — drives the UI's honesty messaging. */
export type PlcFidelity =
  | "full" // L5X with routine logic, tags, AOIs, UDTs
  | "partial" // L5X but some sections missing/encoded
  | "summary" // .ACD: only top-level metadata could be read
  | "none"; // could not parse at all

export interface PlcTag {
  name: string;
  dataType: string;
  scope: "controller" | "program";
  /** Owning program name when scope === "program". */
  program?: string;
  description?: string;
  value?: string;
  radix?: string;
  alias?: string; // AliasFor target, if this is an alias tag
  /** dimensions, e.g. "10" or "4,2" for arrays. */
  dimensions?: string;
  constant?: boolean;
  external?: string; // External Access (Read/Write, Read Only, None)
  /** Where this tag is referenced: routine name → rung numbers. */
  usage?: TagUsage[];
}

export interface TagUsage {
  program?: string;
  routine: string;
  /** Rung numbers (ladder) or line numbers (ST) that reference the tag. */
  locations: number[];
  /** read | write | both — best-effort from instruction context. */
  access?: "read" | "write" | "both" | "ref";
}

export interface PlcRung {
  number: number;
  /** Neutral-text ladder logic, e.g. "XIC(Start)OTE(Motor)". */
  text: string;
  comment?: string;
  /** Tag names referenced on this rung. */
  tags: string[];
}

export interface PlcRoutine {
  name: string;
  type: "RLL" | "ST" | "FBD" | "SFC" | "Unknown"; // ladder | structured text | ...
  description?: string;
  program: string;
  /** Ladder rungs (type === RLL). */
  rungs?: PlcRung[];
  /** Structured Text / source lines (type === ST). */
  stLines?: string[];
  /** Tags referenced anywhere in this routine. */
  referencedTags: string[];
  /** Routines this routine calls via JSR/JXR/SBR. */
  calledRoutines: string[];
  rungCount: number;
}

export interface PlcProgram {
  name: string;
  description?: string;
  /** Routine that runs first (MainRoutine). */
  mainRoutine?: string;
  routines: PlcRoutine[];
  /** Program-scoped tags. */
  tags: PlcTag[];
  /** Task that schedules this program, if known. */
  task?: string;
}

export interface PlcTask {
  name: string;
  type?: string; // CONTINUOUS | PERIODIC | EVENT
  rate?: string; // ms for periodic
  priority?: string;
  /** Program names scheduled by this task. */
  programs: string[];
}

export interface AoiParameter {
  name: string;
  dataType: string;
  usage: string; // Input | Output | InOut
  required?: boolean;
  description?: string;
}

export interface PlcAoi {
  name: string;
  description?: string;
  revision?: string;
  parameters: AoiParameter[];
  localTags: PlcTag[];
  routines: PlcRoutine[];
  /** Where this AOI is instantiated: routine name → rung numbers. */
  usage: TagUsage[];
}

export interface UdtMember {
  name: string;
  dataType: string;
  description?: string;
  dimension?: string;
  radix?: string;
  hidden?: boolean;
}

export interface PlcUdt {
  name: string;
  description?: string;
  members: UdtMember[];
  /** Tags / members that use this UDT as their data type. */
  usedBy: string[];
}

export interface PlcModule {
  name: string;
  catalogNumber?: string;
  vendor?: string;
  productType?: string;
  parentModule?: string;
  slot?: string;
  description?: string;
}

export interface PlcController {
  name: string;
  processorType?: string;
  majorRev?: string;
  minorRev?: string;
  description?: string;
  /** Controller-scoped tags. */
  tags: PlcTag[];
}

export interface PlcProjectIR {
  source: PlcSource;
  fidelity: PlcFidelity;
  /** Why fidelity is limited (shown to the user instead of a dead click). */
  fidelityNote?: string;
  softwareRevision?: string;
  exportDate?: string;
  targetName?: string;
  controller: PlcController;
  tasks: PlcTask[];
  programs: PlcProgram[];
  aois: PlcAoi[];
  udts: PlcUdt[];
  modules: PlcModule[];
  /** Roll-up counts for quick display + summary fidelity. */
  stats: {
    programs: number;
    routines: number;
    tags: number;
    aois: number;
    udts: number;
    modules: number;
    rungs: number;
  };
}

/** A node id is a stable, URL-safe path used by the Explorer + API.
 *  e.g.  controller
 *        task:MainTask
 *        program:Main
 *        routine:Main/MainRoutine
 *        tag:controller/Motor_Run
 *        tag:program/Main/Conv_Speed
 *        aoi:Conveyor_Start
 *        udt:Conveyor_Data
 *        module:Local                                                        */
export type PlcNodeType =
  | "controller"
  | "task"
  | "program"
  | "routine"
  | "tag"
  | "aoi"
  | "udt"
  | "module";

export function emptyIR(source: PlcSource = "unknown"): PlcProjectIR {
  return {
    source,
    fidelity: "none",
    controller: { name: "Controller", tags: [] },
    tasks: [],
    programs: [],
    aois: [],
    udts: [],
    modules: [],
    stats: {
      programs: 0,
      routines: 0,
      tags: 0,
      aois: 0,
      udts: 0,
      modules: 0,
      rungs: 0,
    },
  };
}

export function computeStats(ir: PlcProjectIR): PlcProjectIR["stats"] {
  let routines = 0;
  let rungs = 0;
  let tags = ir.controller.tags.length;
  for (const p of ir.programs) {
    routines += p.routines.length;
    tags += p.tags.length;
    for (const r of p.routines) rungs += r.rungCount;
  }
  return {
    programs: ir.programs.length,
    routines,
    tags,
    aois: ir.aois.length,
    udts: ir.udts.length,
    modules: ir.modules.length,
    rungs,
  };
}
