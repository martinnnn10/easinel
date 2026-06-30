import { XMLParser } from "fast-xml-parser";
import {
  type PlcProjectIR,
  type PlcProgram,
  type PlcRoutine,
  type PlcRung,
  type PlcTag,
  type PlcAoi,
  type PlcUdt,
  type PlcTask,
  type PlcModule,
  type AoiParameter,
  type UdtMember,
  type TagUsage,
  emptyIR,
  computeStats,
} from "./ir";

// ─────────────────────────────────────────────────────────────────────────
// L5X parser (Rockwell Studio 5000 / RSLogix 5000 export).
//
// L5X is XML. We parse it into the vendor-neutral PlcProjectIR. The parser is
// defensive: L5X exports vary by software revision and by what was exported
// (whole project vs a single routine), so every section is optional and we
// degrade to "partial" fidelity rather than throwing.
//
// Cross-references (which rung/routine uses a tag, which routines a routine
// calls) are derived in a second pass from the parsed rung neutral-text, so we
// don't depend on Rockwell's optional <Dependencies> section being present.
// ─────────────────────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep CDATA/text under a stable key.
  textNodeName: "#text",
  cdataPropName: "#cdata",
  // Always make these collections arrays even when there's a single element,
  // so downstream code never has to branch on array-vs-object.
  isArray: (name) =>
    [
      "Tag",
      "Program",
      "Routine",
      "Rung",
      "Line",
      "Task",
      "ScheduledProgram",
      "AddOnInstructionDefinition",
      "Parameter",
      "DataType",
      "Member",
      "Module",
      "LocalTag",
      "RoutineName",
    ].includes(name),
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return decode(node);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    const t = (o["#cdata"] ?? o["#text"]) as string | undefined;
    if (typeof t === "string") return decode(t);
  }
  return undefined;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/** Extract referenced tag operands from ladder neutral text, e.g.
 *  "XIC(Start)TON(Timer_1,?,?)OTE(Motor.Run)" → [Start, Timer_1, Motor.Run]. */
function tagsFromNeutralText(t: string): string[] {
  const tags = new Set<string>();
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const operands = m[1].split(",");
    for (const raw of operands) {
      const op = raw.trim();
      if (!op || op === "?") continue;
      // skip pure numbers / immediate values
      if (/^[-+]?\d/.test(op)) continue;
      // base tag (strip array index / bit / member for the cross-ref index,
      // but keep the full reference too)
      tags.add(op);
      const base = op.split(/[.[]/)[0];
      if (base && base !== op) tags.add(base);
    }
  }
  return [...tags];
}

// Structured Text references: strip comments, then pull dotted identifiers.
// We exclude IEC keywords/operators so only tag-like tokens remain.
const ST_KEYWORDS = new Set([
  "IF", "THEN", "ELSE", "ELSIF", "END_IF", "FOR", "TO", "BY", "DO", "END_FOR",
  "WHILE", "END_WHILE", "REPEAT", "UNTIL", "END_REPEAT", "CASE", "OF", "END_CASE",
  "AND", "OR", "NOT", "XOR", "MOD", "TRUE", "FALSE", "RETURN", "EXIT",
]);
function tagsFromStructuredText(t: string): string[] {
  // remove (* ... *) and // comments
  const cleaned = t.replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/[^\n]*/g, " ");
  const tags = new Set<string>();
  const re = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const tok = m[0];
    if (ST_KEYWORDS.has(tok.toUpperCase())) continue;
    // skip tokens immediately followed by '(' (function/AOI calls handled elsewhere)
    const after = cleaned[re.lastIndex];
    if (after === "(") continue;
    tags.add(tok);
    const base = tok.split(".")[0];
    if (base && base !== tok) tags.add(base);
  }
  return [...tags];
}

const JSR_RE = /\b(?:JSR|JXR|SBR|FOR)\s*\(\s*([A-Za-z_]\w*)/g;
function calledRoutinesFromText(t: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = JSR_RE.exec(t))) out.add(m[1]);
  return [...out];
}

function parseTag(node: Record<string, unknown>, scope: "controller" | "program", program?: string): PlcTag {
  const comment =
    text((node["Comments"] as Record<string, unknown>)?.["Comment"]) ??
    text(node["Description"]);
  // Inline value (DataValue / Data) is best-effort.
  let value: string | undefined;
  const data = node["Data"];
  if (Array.isArray(data)) {
    const dv = data.find((d) => (d as Record<string, unknown>)["@_Format"] === "Decorated");
    value = text(dv) ?? undefined;
  }
  return {
    name: String(node["@_Name"] ?? ""),
    dataType: String(node["@_DataType"] ?? "—"),
    scope,
    program,
    description: comment,
    radix: node["@_Radix"] ? String(node["@_Radix"]) : undefined,
    dimensions: node["@_Dimensions"] ? String(node["@_Dimensions"]) : undefined,
    constant: node["@_Constant"] === "true",
    external: node["@_ExternalAccess"] ? String(node["@_ExternalAccess"]) : undefined,
    alias: node["@_AliasFor"] ? String(node["@_AliasFor"]) : undefined,
    value,
    usage: [],
  };
}

function parseRoutine(node: Record<string, unknown>, program: string): PlcRoutine {
  const name = String(node["@_Name"] ?? "");
  const rllType = String(node["@_Type"] ?? "RLL");
  const type =
    rllType === "RLL"
      ? "RLL"
      : rllType === "ST"
      ? "ST"
      : rllType === "FBD"
      ? "FBD"
      : rllType === "SFC"
      ? "SFC"
      : "Unknown";

  const description = text(node["Description"]);
  const referenced = new Set<string>();
  const called = new Set<string>();

  let rungs: PlcRung[] | undefined;
  let stLines: string[] | undefined;

  if (type === "RLL") {
    const content = node["RLLContent"] as Record<string, unknown> | undefined;
    const rungNodes = asArray(content?.["Rung"] as unknown[]);
    rungs = rungNodes.map((rRaw, i) => {
      const r = rRaw as Record<string, unknown>;
      const txt = text(r["Text"]) ?? "";
      const cmt = text(r["Comment"]);
      const rungTags = tagsFromNeutralText(txt);
      rungTags.forEach((t) => referenced.add(t));
      calledRoutinesFromText(txt).forEach((c) => called.add(c));
      return {
        number: r["@_Number"] !== undefined ? Number(r["@_Number"]) : i,
        text: txt,
        comment: cmt,
        tags: rungTags,
      };
    });
  } else if (type === "ST") {
    const content = node["STContent"] as Record<string, unknown> | undefined;
    const lineNodes = asArray(content?.["Line"] as unknown[]);
    stLines = lineNodes.map((l) => text(l) ?? "");
    const joined = stLines.join("\n");
    tagsFromStructuredText(joined).forEach((t) => referenced.add(t));
    calledRoutinesFromText(joined).forEach((c) => called.add(c));
  }

  return {
    name,
    type: type as PlcRoutine["type"],
    description,
    program,
    rungs,
    stLines,
    referencedTags: [...referenced],
    calledRoutines: [...called],
    rungCount: rungs?.length ?? stLines?.length ?? 0,
  };
}

function parseProgram(node: Record<string, unknown>): PlcProgram {
  const name = String(node["@_Name"] ?? "");
  const tagsRoot = node["Tags"] as Record<string, unknown> | undefined;
  const tags = asArray(tagsRoot?.["Tag"] as unknown[]).map((t) =>
    parseTag(t as Record<string, unknown>, "program", name)
  );
  const routinesRoot = node["Routines"] as Record<string, unknown> | undefined;
  const routines = asArray(routinesRoot?.["Routine"] as unknown[]).map((r) =>
    parseRoutine(r as Record<string, unknown>, name)
  );
  return {
    name,
    description: text(node["Description"]),
    mainRoutine: node["@_MainRoutineName"] ? String(node["@_MainRoutineName"]) : undefined,
    routines,
    tags,
  };
}

function parseAoi(node: Record<string, unknown>): PlcAoi {
  const name = String(node["@_Name"] ?? "");
  const paramsRoot = node["Parameters"] as Record<string, unknown> | undefined;
  const parameters: AoiParameter[] = asArray(paramsRoot?.["Parameter"] as unknown[]).map((p) => {
    const pp = p as Record<string, unknown>;
    return {
      name: String(pp["@_Name"] ?? ""),
      dataType: String(pp["@_DataType"] ?? "—"),
      usage: String(pp["@_Usage"] ?? "Input"),
      required: pp["@_Required"] === "true",
      description: text(pp["Description"]),
    };
  });
  const localRoot = node["LocalTags"] as Record<string, unknown> | undefined;
  const localTags = asArray(localRoot?.["LocalTag"] as unknown[]).map((t) =>
    parseTag(t as Record<string, unknown>, "program", name)
  );
  const routinesRoot = node["Routines"] as Record<string, unknown> | undefined;
  const routines = asArray(routinesRoot?.["Routine"] as unknown[]).map((r) =>
    parseRoutine(r as Record<string, unknown>, name)
  );
  return {
    name,
    description: text(node["Description"]),
    revision: node["@_Revision"] ? String(node["@_Revision"]) : undefined,
    parameters,
    localTags,
    routines,
    usage: [],
  };
}

function parseUdt(node: Record<string, unknown>): PlcUdt {
  const name = String(node["@_Name"] ?? "");
  const membersRoot = node["Members"] as Record<string, unknown> | undefined;
  const members: UdtMember[] = asArray(membersRoot?.["Member"] as unknown[]).map((m) => {
    const mm = m as Record<string, unknown>;
    return {
      name: String(mm["@_Name"] ?? ""),
      dataType: String(mm["@_DataType"] ?? "—"),
      dimension: mm["@_Dimension"] ? String(mm["@_Dimension"]) : undefined,
      radix: mm["@_Radix"] ? String(mm["@_Radix"]) : undefined,
      hidden: mm["@_Hidden"] === "true",
      description: text(mm["Description"]),
    };
  });
  return {
    name,
    description: text(node["Description"]),
    members,
    usedBy: [],
  };
}

function parseTask(node: Record<string, unknown>): PlcTask {
  const schedRoot = node["ScheduledPrograms"] as Record<string, unknown> | undefined;
  const programs = asArray(schedRoot?.["ScheduledProgram"] as unknown[]).map((p) =>
    String((p as Record<string, unknown>)["@_Name"] ?? "")
  );
  return {
    name: String(node["@_Name"] ?? ""),
    type: node["@_Type"] ? String(node["@_Type"]) : undefined,
    rate: node["@_Rate"] ? String(node["@_Rate"]) : undefined,
    priority: node["@_Priority"] ? String(node["@_Priority"]) : undefined,
    programs,
  };
}

function parseModule(node: Record<string, unknown>): PlcModule {
  return {
    name: String(node["@_Name"] ?? ""),
    catalogNumber: node["@_CatalogNumber"] ? String(node["@_CatalogNumber"]) : undefined,
    vendor: node["@_Vendor"] ? String(node["@_Vendor"]) : undefined,
    productType: node["@_ProductType"] ? String(node["@_ProductType"]) : undefined,
    parentModule: node["@_ParentModule"] ? String(node["@_ParentModule"]) : undefined,
    slot: node["@_ParentModPortId"] ? String(node["@_ParentModPortId"]) : undefined,
    description: text(node["Description"]),
  };
}

/** Second pass: build tag usage + AOI usage + UDT usedBy cross-references. */
function buildCrossReferences(ir: PlcProjectIR): void {
  const tagIndex = new Map<string, PlcTag>();
  for (const t of ir.controller.tags) tagIndex.set(t.name, t);
  for (const p of ir.programs) for (const t of p.tags) tagIndex.set(`${p.name}/${t.name}`, t);

  const aoiNames = new Set(ir.aois.map((a) => a.name));
  const aoiUsage = new Map<string, TagUsage[]>();

  const resolveTag = (program: string, ref: string): PlcTag | undefined => {
    const base = ref.split(/[.[]/)[0];
    return (
      tagIndex.get(`${program}/${ref}`) ??
      tagIndex.get(`${program}/${base}`) ??
      tagIndex.get(ref) ??
      tagIndex.get(base)
    );
  };

  const indexRoutine = (program: string, r: PlcRoutine) => {
    const rec = (ref: string, loc: number) => {
      const tag = resolveTag(program, ref);
      if (tag) {
        tag.usage = tag.usage ?? [];
        const existing = tag.usage.find((u) => u.routine === r.name && u.program === program);
        if (existing) {
          if (!existing.locations.includes(loc)) existing.locations.push(loc);
        } else {
          tag.usage.push({ program, routine: r.name, locations: [loc], access: "ref" });
        }
      }
      // AOI instantiation cross-ref (AOI used like an instruction on a rung).
      const base = ref.split(/[.[]/)[0];
      if (aoiNames.has(base)) {
        const arr = aoiUsage.get(base) ?? [];
        const ex = arr.find((u) => u.routine === r.name && u.program === program);
        if (ex) {
          if (!ex.locations.includes(loc)) ex.locations.push(loc);
        } else {
          arr.push({ program, routine: r.name, locations: [loc], access: "ref" });
        }
        aoiUsage.set(base, arr);
      }
    };
    if (r.rungs) {
      for (const rung of r.rungs) {
        for (const t of rung.tags) rec(t, rung.number);
        // AOI calls may appear as INSTR(name,...) too
        for (const m of rung.text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
          if (aoiNames.has(m[1])) rec(m[1], rung.number);
        }
      }
    } else if (r.stLines) {
      r.stLines.forEach((line, i) => {
        for (const t of tagsFromNeutralText(line)) rec(t, i + 1);
        for (const m of line.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
          if (aoiNames.has(m[1])) rec(m[1], i + 1);
        }
      });
    }
  };

  for (const p of ir.programs) for (const r of p.routines) indexRoutine(p.name, r);
  for (const a of ir.aois) for (const r of a.routines) indexRoutine(a.name, r);

  for (const a of ir.aois) a.usage = aoiUsage.get(a.name) ?? [];

  // UDT usedBy: any tag/member whose dataType is the UDT name.
  const udtNames = new Map(ir.udts.map((u) => [u.name, u]));
  const noteUse = (dataType: string, where: string) => {
    const base = dataType.replace(/\[.*\]$/, "");
    const u = udtNames.get(base);
    if (u && !u.usedBy.includes(where)) u.usedBy.push(where);
  };
  for (const t of ir.controller.tags) noteUse(t.dataType, `Controller tag “${t.name}”`);
  for (const p of ir.programs)
    for (const t of p.tags) noteUse(t.dataType, `Program ${p.name} · tag “${t.name}”`);
  for (const u of ir.udts)
    for (const m of u.members) noteUse(m.dataType, `UDT ${u.name} · member “${m.name}”`);
  for (const a of ir.aois)
    for (const pr of a.parameters) noteUse(pr.dataType, `AOI ${a.name} · parameter “${pr.name}”`);
}

export interface ParseL5XResult {
  ir: PlcProjectIR;
  ok: boolean;
  error?: string;
}

export function parseL5X(xml: string): ParseL5XResult {
  const ir = emptyIR("l5x");
  try {
    const root = parser.parse(xml) as Record<string, unknown>;
    const content = root["RSLogix5000Content"] as Record<string, unknown> | undefined;
    if (!content) {
      ir.fidelity = "none";
      ir.fidelityNote =
        "This file does not look like a Studio 5000 / RSLogix 5000 L5X export (missing <RSLogix5000Content> root).";
      return { ir, ok: false, error: "Not an L5X file" };
    }

    ir.softwareRevision = content["@_SoftwareRevision"]
      ? String(content["@_SoftwareRevision"])
      : undefined;
    ir.exportDate = content["@_ExportDate"] ? String(content["@_ExportDate"]) : undefined;
    ir.targetName = content["@_TargetName"] ? String(content["@_TargetName"]) : undefined;

    const ctrl = content["Controller"] as Record<string, unknown> | undefined;
    if (ctrl) {
      ir.controller = {
        name: String(ctrl["@_Name"] ?? "Controller"),
        processorType: ctrl["@_ProcessorType"] ? String(ctrl["@_ProcessorType"]) : undefined,
        majorRev: ctrl["@_MajorRev"] ? String(ctrl["@_MajorRev"]) : undefined,
        minorRev: ctrl["@_MinorRev"] ? String(ctrl["@_MinorRev"]) : undefined,
        description: text(ctrl["Description"]),
        tags: [],
      };

      // Controller-scoped tags
      const cTags = ctrl["Tags"] as Record<string, unknown> | undefined;
      ir.controller.tags = asArray(cTags?.["Tag"] as unknown[]).map((t) =>
        parseTag(t as Record<string, unknown>, "controller")
      );

      // Data types (UDTs)
      const dtRoot = ctrl["DataTypes"] as Record<string, unknown> | undefined;
      ir.udts = asArray(dtRoot?.["DataType"] as unknown[]).map((d) =>
        parseUdt(d as Record<string, unknown>)
      );

      // AOIs
      const aoiRoot = ctrl["AddOnInstructionDefinitions"] as Record<string, unknown> | undefined;
      ir.aois = asArray(aoiRoot?.["AddOnInstructionDefinition"] as unknown[]).map((a) =>
        parseAoi(a as Record<string, unknown>)
      );

      // Programs
      const progRoot = ctrl["Programs"] as Record<string, unknown> | undefined;
      ir.programs = asArray(progRoot?.["Program"] as unknown[]).map((p) =>
        parseProgram(p as Record<string, unknown>)
      );

      // Tasks
      const taskRoot = ctrl["Tasks"] as Record<string, unknown> | undefined;
      ir.tasks = asArray(taskRoot?.["Task"] as unknown[]).map((t) =>
        parseTask(t as Record<string, unknown>)
      );
      // map task → program.task
      for (const task of ir.tasks) {
        for (const progName of task.programs) {
          const prog = ir.programs.find((p) => p.name === progName);
          if (prog) prog.task = task.name;
        }
      }

      // Modules (I/O tree)
      const modRoot = ctrl["Modules"] as Record<string, unknown> | undefined;
      ir.modules = asArray(modRoot?.["Module"] as unknown[]).map((m) =>
        parseModule(m as Record<string, unknown>)
      );
    }

    buildCrossReferences(ir);
    ir.stats = computeStats(ir);

    // Fidelity assessment.
    const hasLogic = ir.programs.some((p) =>
      p.routines.some((r) => (r.rungs?.length ?? 0) > 0 || (r.stLines?.length ?? 0) > 0)
    );
    if (ir.stats.programs === 0 && ir.stats.tags === 0) {
      ir.fidelity = "summary";
      ir.fidelityNote =
        "The L5X parsed but contained no programs or tags — it may be a component-only export (e.g. a single AOID or UDT).";
    } else if (hasLogic) {
      ir.fidelity = "full";
    } else {
      ir.fidelity = "partial";
      ir.fidelityNote =
        "Programs and tags were parsed, but no routine logic (ladder/ST) was found in this export. Re-export the full project from Studio 5000 with routines included for rung-level exploration.";
    }

    return { ir, ok: true };
  } catch (err) {
    ir.fidelity = "none";
    ir.fidelityNote = `Could not parse this L5X file: ${(err as Error).message}`;
    return { ir, ok: false, error: (err as Error).message };
  }
}
