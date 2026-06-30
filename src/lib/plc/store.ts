import { db, ensureDb } from "@/lib/db";
import { plcProjects } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id } from "@/lib/util";
import type { PlcProjectIR } from "./ir";
import { parseL5X } from "./parseL5X";
import { parseACD } from "./parseACD";

// ─────────────────────────────────────────────────────────────────────────
// Persistence + parsing entrypoint for PLC projects.
// ─────────────────────────────────────────────────────────────────────────

export function parsePlcBuffer(buffer: Buffer, filename: string): PlcProjectIR {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "acd") {
    return parseACD(buffer, filename);
  }
  // Default: treat as L5X / XML text.
  const xml = buffer.toString("utf-8");
  return parseL5X(xml).ir;
}

export async function savePlcProject(
  orgId: string,
  opts: {
    documentId: string;
    assetId?: string | null;
    filename: string;
    ir: PlcProjectIR;
    fixedId?: string;
  }
): Promise<string> {
  if (!orgId) throw new Error("savePlcProject() requires orgId");
  await ensureDb();
  const rowId = opts.fixedId ?? id("plc");
  await db.insert(plcProjects).values({
    id: rowId,
    orgId,
    documentId: opts.documentId,
    assetId: opts.assetId ?? null,
    filename: opts.filename,
    source: opts.ir.source,
    fidelity: opts.ir.fidelity,
    controllerName: opts.ir.controller.name,
    processorType: opts.ir.controller.processorType ?? null,
    softwareRevision: opts.ir.softwareRevision ?? null,
    programCount: opts.ir.stats.programs,
    routineCount: opts.ir.stats.routines,
    tagCount: opts.ir.stats.tags,
    aoiCount: opts.ir.stats.aois,
    udtCount: opts.ir.stats.udts,
    ir: JSON.stringify(opts.ir),
  });
  return rowId;
}

export interface PlcProjectRow {
  id: string;
  documentId: string;
  assetId: string | null;
  filename: string;
  source: string;
  fidelity: string;
  controllerName: string | null;
  processorType: string | null;
  softwareRevision: string | null;
  programCount: number;
  routineCount: number;
  tagCount: number;
  aoiCount: number;
  udtCount: number;
  createdAt: number;
}

function rowSelect() {
  return {
    id: plcProjects.id,
    documentId: plcProjects.documentId,
    assetId: plcProjects.assetId,
    filename: plcProjects.filename,
    source: plcProjects.source,
    fidelity: plcProjects.fidelity,
    controllerName: plcProjects.controllerName,
    processorType: plcProjects.processorType,
    softwareRevision: plcProjects.softwareRevision,
    programCount: plcProjects.programCount,
    routineCount: plcProjects.routineCount,
    tagCount: plcProjects.tagCount,
    aoiCount: plcProjects.aoiCount,
    udtCount: plcProjects.udtCount,
    createdAt: plcProjects.createdAt,
  };
}

export async function listPlcProjects(
  orgId: string,
  assetId?: string | null
): Promise<PlcProjectRow[]> {
  if (!orgId) throw new Error("listPlcProjects() requires orgId");
  await ensureDb();
  const where = assetId
    ? and(eq(plcProjects.orgId, orgId), eq(plcProjects.assetId, assetId))
    : eq(plcProjects.orgId, orgId);
  const rows = await db.select(rowSelect()).from(plcProjects).where(where).orderBy(desc(plcProjects.createdAt));
  return rows.map(normalizeRow);
}

export async function getPlcProject(
  orgId: string,
  projectId: string
): Promise<{ row: PlcProjectRow; ir: PlcProjectIR } | undefined> {
  if (!orgId) throw new Error("getPlcProject() requires orgId");
  await ensureDb();
  const rows = await db.select().from(plcProjects).where(and(eq(plcProjects.orgId, orgId), eq(plcProjects.id, projectId)));
  const r = rows[0];
  if (!r) return undefined;
  return { row: normalizeRow(r), ir: JSON.parse(r.ir) as PlcProjectIR };
}

export async function getPlcProjectByDocument(
  orgId: string,
  documentId: string
): Promise<{ row: PlcProjectRow; ir: PlcProjectIR } | undefined> {
  if (!orgId) throw new Error("getPlcProjectByDocument() requires orgId");
  await ensureDb();
  const rows = await db.select().from(plcProjects).where(and(eq(plcProjects.orgId, orgId), eq(plcProjects.documentId, documentId)));
  const r = rows[0];
  if (!r) return undefined;
  return { row: normalizeRow(r), ir: JSON.parse(r.ir) as PlcProjectIR };
}

function normalizeRow(r: typeof plcProjects.$inferSelect | Record<string, unknown>): PlcProjectRow {
  const createdAt = (r as { createdAt: unknown }).createdAt;
  return {
    id: String((r as Record<string, unknown>).id),
    documentId: String((r as Record<string, unknown>).documentId),
    assetId: ((r as Record<string, unknown>).assetId as string) ?? null,
    filename: String((r as Record<string, unknown>).filename),
    source: String((r as Record<string, unknown>).source),
    fidelity: String((r as Record<string, unknown>).fidelity),
    controllerName: ((r as Record<string, unknown>).controllerName as string) ?? null,
    processorType: ((r as Record<string, unknown>).processorType as string) ?? null,
    softwareRevision: ((r as Record<string, unknown>).softwareRevision as string) ?? null,
    programCount: Number((r as Record<string, unknown>).programCount ?? 0),
    routineCount: Number((r as Record<string, unknown>).routineCount ?? 0),
    tagCount: Number((r as Record<string, unknown>).tagCount ?? 0),
    aoiCount: Number((r as Record<string, unknown>).aoiCount ?? 0),
    udtCount: Number((r as Record<string, unknown>).udtCount ?? 0),
    createdAt: createdAt instanceof Date ? createdAt.getTime() : Number(createdAt),
  };
}

/** Build a compact, retrievable text summary of the parsed project so PLC
 *  structure feeds the Copilot's RAG just like any other document. */
export function plcSummaryText(ir: PlcProjectIR, filename: string): string {
  const lines: string[] = [];
  lines.push(`PLC PROJECT EXPORT — ${filename} (${ir.source.toUpperCase()}, fidelity: ${ir.fidelity})`);
  lines.push(
    `Controller: ${ir.controller.name}${ir.controller.processorType ? ` (${ir.controller.processorType})` : ""}` +
      (ir.softwareRevision ? `, software ${ir.softwareRevision}` : "")
  );
  lines.push(
    `Contents: ${ir.stats.programs} programs, ${ir.stats.routines} routines, ${ir.stats.tags} tags, ${ir.stats.aois} AOIs, ${ir.stats.udts} UDTs, ${ir.stats.modules} I/O modules.`
  );
  for (const p of ir.programs) {
    lines.push(
      `Program "${p.name}"${p.description ? ` — ${p.description}` : ""}: routines ${p.routines
        .map((r) => `${r.name} (${r.type}, ${r.rungCount} rungs)`)
        .join(", ")}.`
    );
  }
  if (ir.aois.length) lines.push(`AOIs: ${ir.aois.map((a) => a.name).join(", ")}.`);
  if (ir.udts.length) lines.push(`UDTs: ${ir.udts.map((u) => u.name).join(", ")}.`);
  if (ir.fidelityNote) lines.push(`Note: ${ir.fidelityNote}`);
  return lines.join("\n");
}
