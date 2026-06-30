import type {
  PlcProjectIR,
  PlcNodeType,
  PlcRoutine,
  PlcTag,
} from "./ir";

// ─────────────────────────────────────────────────────────────────────────
// Node resolution + tree building.
//
// The Explorer addresses every element by a stable string node id. These
// helpers turn the IR into (a) a tree for the sidebar and (b) a resolved
// detail payload for a clicked node — including AI-explanation context.
// Every resolver returns a typed result so the UI never hits a dead click.
// ─────────────────────────────────────────────────────────────────────────

export interface TreeNode {
  id: string;
  type: PlcNodeType | "group";
  label: string;
  sublabel?: string;
  icon: string;
  children?: TreeNode[];
  /** group nodes are non-navigable headers (e.g. "Programs (4)"). */
  group?: boolean;
}

export function buildTree(ir: PlcProjectIR): TreeNode[] {
  const root: TreeNode[] = [];

  // Controller
  root.push({
    id: "controller",
    type: "controller",
    label: ir.controller.name || "Controller",
    sublabel: ir.controller.processorType,
    icon: "cpu",
  });

  // Tasks → Programs → Routines
  if (ir.tasks.length) {
    root.push({
      id: "group:tasks",
      type: "group",
      group: true,
      label: `Tasks (${ir.tasks.length})`,
      icon: "clock",
      children: ir.tasks.map((t) => ({
        id: `task:${t.name}`,
        type: "task" as const,
        label: t.name,
        sublabel: t.type,
        icon: "clock",
        children: t.programs
          .map((pn) => ir.programs.find((p) => p.name === pn))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => programNode(p)),
      })),
    });
  }

  // Programs not under any task (or all programs if no tasks)
  const scheduled = new Set(ir.tasks.flatMap((t) => t.programs));
  const looseProgs = ir.programs.filter((p) => !scheduled.has(p.name));
  if (looseProgs.length) {
    root.push({
      id: "group:programs",
      type: "group",
      group: true,
      label: `Programs (${looseProgs.length})`,
      icon: "folder",
      children: looseProgs.map((p) => programNode(p)),
    });
  }

  // Controller tags
  if (ir.controller.tags.length) {
    root.push({
      id: "group:ctags",
      type: "group",
      group: true,
      label: `Controller Tags (${ir.controller.tags.length})`,
      icon: "tag",
      children: ir.controller.tags.map((t) => tagNode(t, "controller")),
    });
  }

  // AOIs
  if (ir.aois.length) {
    root.push({
      id: "group:aois",
      type: "group",
      group: true,
      label: `Add-On Instructions (${ir.aois.length})`,
      icon: "chip",
      children: ir.aois.map((a) => ({
        id: `aoi:${a.name}`,
        type: "aoi" as const,
        label: a.name,
        sublabel: `${a.parameters.length} params`,
        icon: "chip",
      })),
    });
  }

  // UDTs
  if (ir.udts.length) {
    root.push({
      id: "group:udts",
      type: "group",
      group: true,
      label: `User-Defined Types (${ir.udts.length})`,
      icon: "braces",
      children: ir.udts.map((u) => ({
        id: `udt:${u.name}`,
        type: "udt" as const,
        label: u.name,
        sublabel: `${u.members.length} members`,
        icon: "braces",
      })),
    });
  }

  // Modules
  if (ir.modules.length) {
    root.push({
      id: "group:modules",
      type: "group",
      group: true,
      label: `I/O Modules (${ir.modules.length})`,
      icon: "plug",
      children: ir.modules.map((m) => ({
        id: `module:${m.name}`,
        type: "module" as const,
        label: m.name,
        sublabel: m.catalogNumber,
        icon: "plug",
      })),
    });
  }

  return root;
}

function programNode(p: PlcProjectIR["programs"][number]): TreeNode {
  return {
    id: `program:${p.name}`,
    type: "program",
    label: p.name,
    sublabel: `${p.routines.length} routines`,
    icon: "folder",
    children: [
      ...p.routines.map((r) => ({
        id: `routine:${p.name}/${r.name}`,
        type: "routine" as const,
        label: r.name,
        sublabel: r.type + (r.name === p.mainRoutine ? " · main" : ""),
        icon: r.type === "ST" ? "code" : "ladder",
      })),
      ...(p.tags.length
        ? [
            {
              id: `group:ptags:${p.name}`,
              type: "group" as const,
              group: true,
              label: `Program Tags (${p.tags.length})`,
              icon: "tag",
              children: p.tags.map((t) => tagNode(t, "program", p.name)),
            },
          ]
        : []),
    ],
  };
}

function tagNode(t: PlcTag, scope: "controller" | "program", program?: string): TreeNode {
  const idScope = scope === "controller" ? "controller" : `program/${program}`;
  return {
    id: `tag:${idScope}/${t.name}`,
    type: "tag",
    label: t.name,
    sublabel: t.dataType,
    icon: t.alias ? "alias" : "tag",
  };
}

// ───────────────────────── Detail resolution ─────────────────────────

export interface NodeDetail {
  found: boolean;
  type: PlcNodeType | "unknown";
  id: string;
  title: string;
  subtitle?: string;
  /** Structured fields for the detail panel (rendered generically). */
  data: Record<string, unknown>;
  breadcrumb: { id: string; label: string }[];
  /** Context string handed to the AI explanation endpoint. */
  aiContext: string;
  /** When data is partial/missing, a friendly explanation (never a dead click). */
  notice?: string;
}

function findTag(ir: PlcProjectIR, scope: string, name: string): { tag: PlcTag; program?: string } | undefined {
  if (scope === "controller") {
    const tag = ir.controller.tags.find((t) => t.name === name);
    return tag ? { tag } : undefined;
  }
  // scope === "program/<ProgName>"
  const prog = scope.split("/")[1];
  const p = ir.programs.find((x) => x.name === prog);
  const tag = p?.tags.find((t) => t.name === name);
  return tag ? { tag, program: prog } : undefined;
}

export function resolveNode(ir: PlcProjectIR, nodeId: string): NodeDetail {
  const [type, ...rest] = nodeId.split(":");
  const path = rest.join(":");

  const base: NodeDetail = {
    found: false,
    type: "unknown",
    id: nodeId,
    title: nodeId,
    data: {},
    breadcrumb: [{ id: "controller", label: ir.controller.name || "Controller" }],
    aiContext: "",
  };

  switch (type) {
    case "controller": {
      return {
        ...base,
        found: true,
        type: "controller",
        title: ir.controller.name || "Controller",
        subtitle: ir.controller.processorType,
        notice:
          ir.fidelity === "summary" || ir.fidelity === "none"
            ? ir.fidelityNote
            : undefined,
        data: {
          processorType: ir.controller.processorType ?? "—",
          revision:
            ir.controller.majorRev != null
              ? `${ir.controller.majorRev}.${ir.controller.minorRev ?? "0"}`
              : ir.softwareRevision ?? "—",
          description: ir.controller.description ?? "—",
          softwareRevision: ir.softwareRevision ?? "—",
          exportDate: ir.exportDate ?? "—",
          stats: ir.stats,
          controllerTags: ir.controller.tags.length,
        },
        aiContext: `Controller "${ir.controller.name}" (${ir.controller.processorType ?? "unknown processor"}). ${ir.stats.programs} programs, ${ir.stats.routines} routines, ${ir.stats.tags} tags, ${ir.stats.aois} AOIs, ${ir.stats.udts} UDTs.`,
      };
    }

    case "task": {
      const t = ir.tasks.find((x) => x.name === path);
      if (!t) return notFound(base, "task", path);
      return {
        ...base,
        found: true,
        type: "task",
        title: t.name,
        subtitle: `${t.type ?? "Task"}${t.rate ? ` · ${t.rate}ms` : ""}`,
        data: {
          type: t.type ?? "—",
          rate: t.rate ?? "—",
          priority: t.priority ?? "—",
          programs: t.programs,
        },
        breadcrumb: [...base.breadcrumb, { id: `task:${t.name}`, label: t.name }],
        aiContext: `Task "${t.name}" (${t.type ?? "?"}${t.rate ? `, ${t.rate}ms` : ""}) scheduling programs: ${t.programs.join(", ") || "none"}.`,
      };
    }

    case "program": {
      const p = ir.programs.find((x) => x.name === path);
      if (!p) return notFound(base, "program", path);
      return {
        ...base,
        found: true,
        type: "program",
        title: p.name,
        subtitle: `${p.routines.length} routines · ${p.tags.length} tags`,
        data: {
          __program: p.name,
          description: p.description ?? "—",
          mainRoutine: p.mainRoutine ?? "—",
          task: p.task ?? "—",
          routines: p.routines.map((r) => ({
            name: r.name,
            type: r.type,
            rungs: r.rungCount,
            isMain: r.name === p.mainRoutine,
          })),
          tags: p.tags.map((t) => ({ name: t.name, dataType: t.dataType })),
          calledRoutines: [...new Set(p.routines.flatMap((r) => r.calledRoutines))],
        },
        breadcrumb: [...base.breadcrumb, { id: `program:${p.name}`, label: p.name }],
        aiContext:
          `Program "${p.name}". Main routine: ${p.mainRoutine ?? "?"}. ` +
          `Routines: ${p.routines.map((r) => `${r.name} (${r.type}, ${r.rungCount} rungs)`).join("; ")}. ` +
          `Program tags: ${p.tags.map((t) => `${t.name}:${t.dataType}`).join(", ") || "none"}.`,
      };
    }

    case "routine": {
      const [prog, rname] = path.split("/");
      const p = ir.programs.find((x) => x.name === prog);
      const r = p?.routines.find((x) => x.name === rname) ?? findAoiRoutine(ir, prog, rname);
      if (!r) return notFound(base, "routine", path);
      const notice =
        (!r.rungs?.length && !r.stLines?.length)
          ? `This ${r.type} routine has no exportable logic in the uploaded file. If you expected ladder rungs, re-export the project from Studio 5000 with routine content included.`
          : undefined;
      return {
        ...base,
        found: true,
        type: "routine",
        title: r.name,
        subtitle: `${prog} · ${r.type}${r.rungCount ? ` · ${r.rungCount} ${r.type === "ST" ? "lines" : "rungs"}` : ""}`,
        notice,
        data: {
          program: prog,
          routineType: r.type,
          description: r.description ?? "—",
          rungs: r.rungs ?? null,
          stLines: r.stLines ?? null,
          referencedTags: r.referencedTags,
          calledRoutines: r.calledRoutines,
        },
        breadcrumb: [
          ...base.breadcrumb,
          { id: `program:${prog}`, label: prog },
          { id: `routine:${prog}/${rname}`, label: r.name },
        ],
        aiContext: routineAiContext(r),
      };
    }

    case "tag": {
      // path = controller/<name>  OR  program/<Prog>/<name>
      const parts = path.split("/");
      let scope: string;
      let name: string;
      if (parts[0] === "controller") {
        scope = "controller";
        name = parts.slice(1).join("/");
      } else {
        scope = `program/${parts[1]}`;
        name = parts.slice(2).join("/");
      }
      const hit = findTag(ir, scope, name);
      if (!hit) return notFound(base, "tag", name);
      const t = hit.tag;
      const reads = (t.usage ?? []).filter((u) => u.access === "write");
      return {
        ...base,
        found: true,
        type: "tag",
        title: t.name,
        subtitle: `${t.dataType} · ${t.scope}${t.program ? ` (${t.program})` : ""}`,
        data: {
          dataType: t.dataType,
          scope: t.scope,
          program: t.program ?? "—",
          description: t.description ?? "—",
          alias: t.alias ?? null,
          dimensions: t.dimensions ?? null,
          radix: t.radix ?? "—",
          externalAccess: t.external ?? "—",
          constant: t.constant ?? false,
          value: t.value ?? null,
          usage: t.usage ?? [],
          usageCount: (t.usage ?? []).reduce((n, u) => n + u.locations.length, 0),
        },
        breadcrumb: [
          ...base.breadcrumb,
          ...(t.program ? [{ id: `program:${t.program}`, label: t.program }] : []),
          { id: nodeId, label: t.name },
        ],
        aiContext:
          `Tag "${t.name}" of type ${t.dataType}, ${t.scope} scope${t.program ? ` in program ${t.program}` : ""}. ` +
          (t.alias ? `Alias for ${t.alias}. ` : "") +
          (t.description ? `Description: ${t.description}. ` : "") +
          `Referenced in: ${(t.usage ?? []).map((u) => `${u.routine} (${u.locations.length}x)`).join(", ") || "no routines found in this export"}.` +
          (reads.length ? ` Written in ${reads.length} place(s).` : ""),
      };
    }

    case "aoi": {
      const a = ir.aois.find((x) => x.name === path);
      if (!a) return notFound(base, "aoi", path);
      return {
        ...base,
        found: true,
        type: "aoi",
        title: a.name,
        subtitle: `Add-On Instruction${a.revision ? ` · rev ${a.revision}` : ""}`,
        data: {
          __aoi: a.name,
          description: a.description ?? "—",
          revision: a.revision ?? "—",
          parameters: a.parameters,
          localTags: a.localTags.map((t) => ({ name: t.name, dataType: t.dataType })),
          routines: a.routines.map((r) => ({ name: r.name, type: r.type, rungs: r.rungCount })),
          usage: a.usage,
          usageCount: a.usage.reduce((n, u) => n + u.locations.length, 0),
        },
        breadcrumb: [...base.breadcrumb, { id: `aoi:${a.name}`, label: a.name }],
        aiContext:
          `Add-On Instruction "${a.name}"${a.revision ? ` rev ${a.revision}` : ""}. ` +
          (a.description ? `${a.description}. ` : "") +
          `Parameters: ${a.parameters.map((p) => `${p.name} (${p.usage} ${p.dataType})`).join(", ") || "none"}. ` +
          `Internal routines: ${a.routines.map((r) => r.name).join(", ") || "none"}. ` +
          `Used in: ${a.usage.map((u) => u.routine).join(", ") || "no routines found in this export"}.`,
      };
    }

    case "udt": {
      const u = ir.udts.find((x) => x.name === path);
      if (!u) return notFound(base, "udt", path);
      return {
        ...base,
        found: true,
        type: "udt",
        title: u.name,
        subtitle: `User-Defined Type · ${u.members.length} members`,
        data: {
          description: u.description ?? "—",
          members: u.members,
          usedBy: u.usedBy,
        },
        breadcrumb: [...base.breadcrumb, { id: `udt:${u.name}`, label: u.name }],
        aiContext:
          `User-Defined Type "${u.name}" with members: ${u.members.map((m) => `${m.name}:${m.dataType}`).join(", ")}. ` +
          `Used by: ${u.usedBy.join("; ") || "no references found in this export"}.`,
      };
    }

    case "module": {
      const m = ir.modules.find((x) => x.name === path);
      if (!m) return notFound(base, "module", path);
      return {
        ...base,
        found: true,
        type: "module",
        title: m.name,
        subtitle: m.catalogNumber,
        data: {
          catalogNumber: m.catalogNumber ?? "—",
          vendor: m.vendor ?? "—",
          productType: m.productType ?? "—",
          parentModule: m.parentModule ?? "—",
          slot: m.slot ?? "—",
          description: m.description ?? "—",
        },
        breadcrumb: [...base.breadcrumb, { id: `module:${m.name}`, label: m.name }],
        aiContext: `I/O Module "${m.name}" (${m.catalogNumber ?? "?"}), vendor ${m.vendor ?? "?"}.`,
      };
    }

    default:
      return notFound(base, "unknown", nodeId);
  }
}

function findAoiRoutine(ir: PlcProjectIR, owner: string, rname: string): PlcRoutine | undefined {
  const a = ir.aois.find((x) => x.name === owner);
  return a?.routines.find((r) => r.name === rname);
}

function routineAiContext(r: PlcRoutine): string {
  const head = `Routine "${r.name}" (${r.type}) in program ${r.program}. ${r.description ? `Comment: ${r.description}. ` : ""}`;
  if (r.rungs?.length) {
    const sample = r.rungs.slice(0, 40).map((x) => `Rung ${x.number}: ${x.text}${x.comment ? `  // ${x.comment}` : ""}`).join("\n");
    return `${head}Ladder logic (neutral text):\n${sample}\nReferenced tags: ${r.referencedTags.join(", ")}. Calls: ${r.calledRoutines.join(", ") || "none"}.`;
  }
  if (r.stLines?.length) {
    return `${head}Structured Text:\n${r.stLines.slice(0, 80).join("\n")}\nReferenced tags: ${r.referencedTags.join(", ")}.`;
  }
  return `${head}No exportable logic content was present in the file.`;
}

function notFound(base: NodeDetail, type: NodeDetail["type"], label: string): NodeDetail {
  return {
    ...base,
    found: false,
    type,
    title: label,
    notice: `This ${type} (“${label}”) wasn't found in the parsed project. It may not have been included in the uploaded export. Try re-exporting the full project as .L5X from Studio 5000.`,
    aiContext: "",
  };
}

// ───────────────────────── Search ─────────────────────────

export interface SearchHit {
  id: string;
  type: PlcNodeType;
  label: string;
  context: string;
}

export function searchNodes(ir: PlcProjectIR, query: string, limit = 50): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const push = (h: SearchHit) => {
    if (hits.length < limit) hits.push(h);
  };

  for (const p of ir.programs) {
    if (p.name.toLowerCase().includes(q)) push({ id: `program:${p.name}`, type: "program", label: p.name, context: "Program" });
    for (const r of p.routines) {
      if (r.name.toLowerCase().includes(q))
        push({ id: `routine:${p.name}/${r.name}`, type: "routine", label: r.name, context: `Routine · ${p.name}` });
    }
    for (const t of p.tags) {
      if (t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q))
        push({ id: `tag:program/${p.name}/${t.name}`, type: "tag", label: t.name, context: `Tag · ${p.name} · ${t.dataType}` });
    }
  }
  for (const t of ir.controller.tags) {
    if (t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q))
      push({ id: `tag:controller/${t.name}`, type: "tag", label: t.name, context: `Controller tag · ${t.dataType}` });
  }
  for (const a of ir.aois) {
    if (a.name.toLowerCase().includes(q)) push({ id: `aoi:${a.name}`, type: "aoi", label: a.name, context: "Add-On Instruction" });
  }
  for (const u of ir.udts) {
    if (u.name.toLowerCase().includes(q)) push({ id: `udt:${u.name}`, type: "udt", label: u.name, context: "User-Defined Type" });
    for (const m of u.members) {
      if (m.name.toLowerCase().includes(q))
        push({ id: `udt:${u.name}`, type: "udt", label: `${u.name}.${m.name}`, context: `UDT member · ${m.dataType}` });
    }
  }
  for (const m of ir.modules) {
    if (m.name.toLowerCase().includes(q) || (m.catalogNumber ?? "").toLowerCase().includes(q))
      push({ id: `module:${m.name}`, type: "module", label: m.name, context: `I/O Module · ${m.catalogNumber ?? ""}` });
  }
  return hits;
}
