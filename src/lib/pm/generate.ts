// ─────────────────────────────────────────────────────────────────────────
// AI PM-PROGRAM GENERATOR — turns a machine identity (an existing asset, or a
// free-text manufacturer / model / serial number) into a COMPLETE preventive-
// maintenance program: five draft PMs at the cadences plants actually run —
// 30-day, 60-day, 90-day, semi-annual (180), and annual (365).
//
// REV 10 — PROCEDURE QUALITY STANDARD. Tasks are now built by ./procedure.ts as
// fully STRUCTURED, correctly-SEQUENCED steps:
//   • Operating-state sequencing: operational observations (machine RUNNING)
//     come first, then a single explicit LOTO transition, then hands-on/contact
//     work (Stopped/LOTO). This fixes the earlier unsafe "LOTO-first" ordering.
//   • Each step carries purpose, operating state, PPE, tools, parts, a step-by-
//     step procedure, measurements, acceptance criteria, out-of-spec action,
//     estimated minutes, skill level, OEM/standard references, and failure modes.
//   • REAL plant history only: recent corrective work orders for the matched
//     asset are summarized into the reasoning and attached as evidence. Nothing
//     here invents failure history, part numbers, prices, or specs.
//
// Hard rules (unchanged): everything produced is a `draft`; nothing is ever
// auto-activated (manage_pm approval required). Grounding is org-scoped; the
// hybrid retriever also reads the shared __global__ OEM library by design.
// ─────────────────────────────────────────────────────────────────────────

import { getAsset, listAssets, createAsset } from "@/lib/assets/repository";
import { listWorkOrders } from "@/lib/workorders/repository";
import { hybridRetrieve } from "@/lib/rag/hybrid";
import { createProgram, type NewPmProgram, type NewPmTask, type PmEvidence } from "./repository";
import { getLiveChatProvider } from "@/lib/ai/providers";
import {
  buildCadenceTasks,
  taskTitleLine,
  type PmTaskDetail,
} from "./procedure";
import type { Asset } from "@/lib/db/schema";

// The fixed cadence ladder the user asked for.
export const PM_CADENCES: { key: string; label: string; days: number }[] = [
  { key: "30d", label: "30-Day", days: 30 },
  { key: "60d", label: "60-Day", days: 60 },
  { key: "90d", label: "90-Day", days: 90 },
  { key: "semi_annual", label: "Semi-Annual", days: 180 },
  { key: "annual", label: "Annual", days: 365 },
];

export interface MachineIdentity {
  assetId?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  assetType?: string | null;
  name?: string | null;
}

export interface GeneratePmInput {
  assetId?: string | null;
  // Confirm-before-save: create this asset and link the PMs to it.
  createAsset?: {
    name: string;
    assetTag?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    assetType?: string | null;
    parentAssetId?: string | null;
    assetLevel?: string | null;
  } | null;
  // Free-text identity (used when no assetId, or to enrich it).
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  assetType?: string | null;
}

export interface GeneratedCadence {
  cadenceKey: string;
  programId: string;
  title: string;
  intervalDays: number;
  taskCount: number;
}

export interface GeneratePmResult {
  identity: MachineIdentity;
  matchedAssetId: string | null;
  evidenceCount: number;
  groundedInDocs: boolean;
  plantHistoryCount: number;
  cadences: GeneratedCadence[];
  note: string;
}

// Coarse machine-type detection from any identity text, so a structured ladder
// is at least type-appropriate when we have no asset record and no docs.
function detectType(idn: MachineIdentity): string {
  const s = `${idn.assetType ?? ""} ${idn.model ?? ""} ${idn.name ?? ""} ${idn.manufacturer ?? ""}`.toLowerCase();
  if (/conveyor|belt/.test(s)) return "conveyor";
  if (/compressor/.test(s)) return "compressor";
  if (/pump/.test(s)) return "pump";
  if (/gearbox|reducer|gear/.test(s)) return "gearbox";
  if (/vfd|drive|inverter/.test(s)) return "drive";
  if (/motor/.test(s)) return "motor";
  return "general";
}

function titleFor(idn: MachineIdentity, label: string): string {
  const machine =
    idn.name ||
    [idn.manufacturer, idn.model].filter(Boolean).join(" ") ||
    idn.model ||
    idn.assetType ||
    "Machine";
  return `${label} PM — ${machine}`.slice(0, 90);
}

// Resolve the machine identity from an assetId and/or free-text fields. If only
// a model/serial is given, try to match an existing asset so the PM links to it.
async function resolveIdentity(
  orgId: string,
  input: GeneratePmInput
): Promise<{ identity: MachineIdentity; matchedAssetId: string | null; asset?: Asset }> {
  if (input.assetId) {
    const a = await getAsset(orgId, input.assetId);
    if (a) {
      return {
        asset: a,
        matchedAssetId: a.id,
        identity: {
          assetId: a.id,
          manufacturer: a.manufacturer ?? input.manufacturer ?? null,
          model: a.model ?? input.model ?? null,
          serialNumber: a.serialNumber ?? input.serialNumber ?? null,
          assetType: a.assetType ?? input.assetType ?? null,
          name: a.name,
        },
      };
    }
  }
  // No assetId (or not found): try to match by serial, then model.
  let matched: Asset | undefined;
  if (input.serialNumber) {
    matched = (await listAssets(orgId, { search: input.serialNumber })).find(
      (a) => (a.serialNumber ?? "").toLowerCase() === input.serialNumber!.toLowerCase()
    );
  }
  if (!matched && input.model) {
    matched = (await listAssets(orgId, { search: input.model }))[0];
  }
  if (matched) {
    return {
      asset: matched,
      matchedAssetId: matched.id,
      identity: {
        assetId: matched.id,
        manufacturer: matched.manufacturer ?? input.manufacturer ?? null,
        model: matched.model ?? input.model ?? null,
        serialNumber: matched.serialNumber ?? input.serialNumber ?? null,
        assetType: matched.assetType ?? input.assetType ?? null,
        name: matched.name,
      },
    };
  }
  return {
    matchedAssetId: null,
    identity: {
      assetId: null,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      serialNumber: input.serialNumber ?? null,
      assetType: input.assetType ?? null,
      name: null,
    },
  };
}

// A compact, REAL plant-history record drawn from this asset's corrective work
// orders. Used to ground the PM in what has actually failed — never invented.
interface PlantFailure {
  when: string;
  symptom: string | null;
  rootCause: string | null;
  failedPart: string | null;
  repairAction: string | null;
}

async function getPlantHistory(orgId: string, assetId: string | null): Promise<PlantFailure[]> {
  if (!assetId) return [];
  // Corrective work orders for THIS asset, most recent first. Tenant-scoped.
  const wos = await listWorkOrders(orgId, { assetId, approval: "all" });
  return wos
    .filter((w) => w.type === "corrective" || w.rootCause || w.failedPart)
    .slice(0, 8)
    .map((w) => ({
      when: new Date(ms(w.closedAt) || ms(w.createdAt)).toISOString().slice(0, 10),
      symptom: w.symptom ?? w.title ?? null,
      rootCause: w.rootCause ?? null,
      failedPart: w.failedPart ?? null,
      repairAction: w.repairAction ?? null,
    }));
}

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : Number(v ?? 0);
}

// Turn real plant failures into a short grounded narrative + an extra emphasis
// note steering the PM toward the components that have actually failed here.
function summarizePlantHistory(history: PlantFailure[]): { narrative: string; emphasis: string[] } {
  if (history.length === 0) return { narrative: "", emphasis: [] };
  const lines = history.map(
    (h) =>
      `• ${h.when}: ${h.symptom ?? "issue"}${h.rootCause ? ` — root cause: ${h.rootCause}` : ""}${
        h.failedPart ? `; failed part: ${h.failedPart}` : ""
      }${h.repairAction ? `; repair: ${h.repairAction}` : ""}`
  );
  const emphasis = Array.from(
    new Set(
      history
        .flatMap((h) => [h.rootCause, h.failedPart])
        .filter((x): x is string => Boolean(x))
        .map((x) => x.trim())
    )
  ).slice(0, 5);
  return {
    narrative: `This machine's own recorded maintenance history (${history.length} corrective work order(s)):\n${lines.join("\n")}`,
    emphasis,
  };
}

// Optionally let a live LLM tighten the per-step procedure wording using the
// retrieved OEM/PM document excerpts — WITHOUT changing the structure, the
// operating state, or the sequencing, and without inventing specs/part numbers.
// Falls back silently to the deterministic structured tasks.
async function refineDetailWithDocs(
  idn: MachineIdentity,
  label: string,
  tasks: PmTaskDetail[],
  docContext: string,
  emphasis: string[]
): Promise<PmTaskDetail[]> {
  const provider = getLiveChatProvider();
  if (!provider || (!docContext.trim() && emphasis.length === 0)) return tasks;
  try {
    let text = "";
    const gen = provider.stream({
      system:
        "You are a reliability engineer refining a preventive-maintenance procedure for ONE service interval. " +
        "You are given a JSON array of structured task steps. Improve the SPECIFICITY of each step's `procedure`, " +
        "`measurements`, and `acceptanceCriteria` using the OEM/maintenance excerpts and the plant's own failure emphasis. " +
        "STRICT RULES: keep the same number of steps and the same `operatingState` and ordering for each; never move a " +
        "Running observation after the LOTO step; never invent part numbers, torque values, quantities, or specs that are " +
        "not in the excerpts (speak generally if unknown, e.g. 'per OEM torque spec'); return ONLY a valid JSON array with " +
        "the same shape. Do not add commentary.",
      maxTokens: 1500,
      messages: [
        {
          role: "user",
          content:
            `Machine: ${[idn.manufacturer, idn.model].filter(Boolean).join(" ") || idn.name || idn.assetType || "machine"}\n` +
            `Interval: ${label}\n` +
            (emphasis.length ? `Plant failure emphasis (prioritize catching these): ${emphasis.join("; ")}\n` : "") +
            `\nOEM / maintenance excerpts:\n${docContext.slice(0, 3500) || "(none)"}\n\n` +
            `Task steps JSON:\n${JSON.stringify(tasks)}`,
        },
      ],
    });
    for await (const delta of gen) text += delta;
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return tasks;
    const parsed = JSON.parse(match[0]) as PmTaskDetail[];
    // Validate: same length and operating states preserved in order; else keep ours.
    if (
      !Array.isArray(parsed) ||
      parsed.length !== tasks.length ||
      parsed.some((p, i) => !p || p.operatingState !== tasks[i].operatingState || !p.title)
    ) {
      return tasks;
    }
    return parsed;
  } catch {
    return tasks;
  }
}

export async function generatePmProgram(
  orgId: string,
  input: GeneratePmInput,
  actor = "system"
): Promise<GeneratePmResult> {
  if (!orgId) throw new Error("generatePmProgram() requires orgId");
  if (!input.assetId && !input.createAsset && !input.model && !input.serialNumber && !input.manufacturer) {
    throw new Error("Provide an asset, or a manufacturer/model/serial number.");
  }

  // Confirm-before-save: if the caller asked to create a new asset, create it
  // first and link the PMs to it (so generated programs are never orphaned).
  let effectiveInput = input;
  if (input.createAsset && !input.assetId) {
    const created = await createAsset(
      orgId,
      {
        name: input.createAsset.name,
        assetTag: input.createAsset.assetTag ?? null,
        manufacturer: input.createAsset.manufacturer ?? null,
        model: input.createAsset.model ?? null,
        serialNumber: input.createAsset.serialNumber ?? null,
        assetType: input.createAsset.assetType ?? null,
        parentAssetId: input.createAsset.parentAssetId ?? null,
        assetLevel: input.createAsset.assetLevel ?? null,
      },
      actor
    );
    effectiveInput = { ...input, assetId: created.id };
  }

  let { identity, matchedAssetId } = await resolveIdentity(orgId, effectiveInput);
  const type = detectType(identity);

  // Asset-first rule (no exceptions): a PM must belong to a machine. If the
  // supplied identity matched no existing asset and the caller didn't explicitly
  // create one, register the machine NOW from its nameplate identity so the
  // generated PMs link to a real asset instead of being orphaned ("Unassigned").
  // The maintenance object model always starts with the machine.
  if (!matchedAssetId) {
    const created = await createAsset(
      orgId,
      {
        name:
          identity.name ||
          [identity.manufacturer, identity.model].filter(Boolean).join(" ") ||
          identity.serialNumber ||
          `New ${type === "general" ? "machine" : type}`,
        manufacturer: identity.manufacturer ?? null,
        model: identity.model ?? null,
        serialNumber: identity.serialNumber ?? null,
        assetType: identity.assetType ?? (type === "general" ? null : type),
      },
      actor
    );
    matchedAssetId = created.id;
    identity = { ...identity, assetId: created.id, name: created.name };
  }

  // ── Grounding 1: retrieve PM docs / OEM manuals for this machine. ──
  const query = [
    identity.manufacturer,
    identity.model,
    identity.assetType,
    identity.name,
    "preventive maintenance schedule interval lubrication inspection torque",
  ]
    .filter(Boolean)
    .join(" ");
  const { chunks } = await hybridRetrieve(query, {
    orgId,
    assetId: matchedAssetId,
    limit: 8,
  });
  const docContext = chunks
    .map((c) => `[${c.filename}] ${c.content}`)
    .join("\n\n")
    .slice(0, 6000);
  const groundedInDocs = chunks.length > 0;

  // ── Grounding 2: REAL plant failure history for this asset (never invented). ──
  const plantHistory = await getPlantHistory(orgId, matchedAssetId);
  const { narrative: historyNarrative, emphasis } = summarizePlantHistory(plantHistory);

  const sharedEvidence: PmEvidence[] = [];
  if (identity.model || identity.serialNumber || identity.manufacturer) {
    sharedEvidence.push({
      kind: "model",
      refId: matchedAssetId,
      detail: `Machine identity: ${[identity.manufacturer, identity.model].filter(Boolean).join(" ")}${
        identity.serialNumber ? ` (S/N ${identity.serialNumber})` : ""
      }`,
    });
  }
  for (const c of chunks.slice(0, 6)) {
    sharedEvidence.push({
      kind: /lesson/i.test(c.filename) ? "lesson" : /pm|maintenance|schedule/i.test(c.filename) ? "pm_history" : "manual",
      refId: c.documentId,
      detail: c.filename,
    });
  }
  // Attach real plant-history work orders as evidence so the PM detail view shows
  // exactly which repairs informed it.
  for (const h of plantHistory.slice(0, 6)) {
    sharedEvidence.push({
      kind: "work_order",
      refId: null,
      detail: `${h.when}: ${h.symptom ?? "issue"}${h.rootCause ? ` — ${h.rootCause}` : ""}${h.failedPart ? ` (failed: ${h.failedPart})` : ""}`,
    });
  }

  const machineLabel =
    [identity.manufacturer, identity.model].filter(Boolean).join(" ") ||
    identity.name ||
    identity.serialNumber ||
    `this ${type}`;

  const cadences: GeneratedCadence[] = [];
  for (const cad of PM_CADENCES) {
    // Deterministic, correctly-sequenced, structured steps for this cadence.
    const structured = buildCadenceTasks(type, cad.days);
    const refined = await refineDetailWithDocs(identity, cad.label, structured, docContext, emphasis);

    // Persisted tasks carry both the title line and the full structured detail.
    const tasks: NewPmTask[] = refined.map((t) => ({
      title: taskTitleLine(t),
      detail: t,
    }));

    // Roll up tools/parts/PPE/labor from the structured steps.
    const tools = uniq(refined.flatMap((t) => t.tools ?? []));
    const parts = uniq(refined.flatMap((t) => t.parts ?? []));
    const safety = uniq([
      ...refined.flatMap((t) => t.safety ?? []),
      "All hands-on work is performed only after LOTO and zero-energy verification (see the LOTO transition step).",
    ]);
    const estLaborMins = refined.reduce((sum, t) => sum + (t.estMinutes ?? 0), 0) || null;

    const reasoning =
      `${cad.label} preventive-maintenance interval for ${machineLabel}. ` +
      `Steps are sequenced by operating state — operational observations are taken while the machine is RUNNING, ` +
      `then the machine is locked out (single explicit LOTO transition step), then all hands-on/contact work is performed de-energized. ` +
      (groundedInDocs
        ? `Procedure specifics were grounded in ${chunks.length} retrieved document excerpt(s) (uploaded manuals / PM docs / OEM library). `
        : `No machine-specific documents were found, so this uses machine-type reliability best practice — upload the OEM manual or a PM schedule to ground it further. `) +
      (historyNarrative
        ? `\n\n${historyNarrative}\nThe procedure emphasizes inspecting/measuring the items that have actually failed on this machine.`
        : ``) +
      `\n\nReview against your run-hours and RCM criticality, then approve to activate scheduling.`;

    const program: NewPmProgram = {
      assetId: matchedAssetId,
      title: titleFor(identity, cad.label),
      failureMode: emphasis[0] ?? null,
      frequencyLabel: cad.label,
      intervalDays: cad.days,
      estLaborMins,
      tools: tools.length ? tools : ["Hand tools", "Torque wrench", "Clamp ammeter", "IR thermometer", "Grease gun"],
      parts,
      safety,
      reasoning,
      confidence: groundedInDocs || plantHistory.length > 0 ? "medium" : "low",
      source: "ai_suggested",
      tasks,
      evidence: sharedEvidence,
      createdBy: actor,
    };
    const created = await createProgram(orgId, program, actor);
    cadences.push({
      cadenceKey: cad.key,
      programId: created.id,
      title: created.title,
      intervalDays: cad.days,
      taskCount: tasks.length,
    });
  }

  const grounds: string[] = [];
  if (groundedInDocs) grounds.push(`${chunks.length} document excerpt(s)`);
  if (plantHistory.length) grounds.push(`${plantHistory.length} real plant work order(s)`);
  const note =
    grounds.length > 0
      ? `Generated 5 draft PM programs for ${machineLabel}, grounded in ${grounds.join(" and ")}. Steps are operating-state sequenced (observe running → LOTO → contact work). Each is a DRAFT — approve to start scheduling.`
      : `Generated 5 draft PM programs for ${machineLabel} from machine-type best practice (operating-state sequenced). No machine-specific documents or plant history were found — upload the OEM manual or link an asset with repair history and regenerate to ground them. Each is a DRAFT — approve to start scheduling.`;

  return {
    identity,
    matchedAssetId,
    evidenceCount: sharedEvidence.length,
    groundedInDocs,
    plantHistoryCount: plantHistory.length,
    cadences,
    note,
  };
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
