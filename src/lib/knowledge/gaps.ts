/**
 * Copilot knowledge gaps — the honest "which manuals should we upload" signal.
 *
 * A gap is recorded when an asset-scoped Copilot question is answered without
 * citing any of the org's OWN documents: i.e. a technician asked about a
 * specific machine and the plant had no uploaded manual/drawing/lesson of its
 * own for the Copilot to ground the answer in (the OEM reference library and
 * general knowledge don't count — the point is to drive uploads of the plant's
 * own documents). Aggregated by machine, this tells the plant exactly where
 * uploading a document would sharpen the Copilot.
 *
 * Nothing is invented — only the org's own real questions are stored, and only
 * when the answer was genuinely ungrounded. Writing is best-effort and never
 * affects the answer the technician receives.
 */

import { db, ensureDb } from "@/lib/db";
import { knowledgeGaps, documents, assets } from "@/lib/db/schema";
import { and, eq, inArray, desc, gte } from "drizzle-orm";
import { id } from "@/lib/util";

export interface GapInput {
  assetId?: string | null;
  question: string;
  citedDocumentIds?: string[];
}

export async function recordGapIfUngrounded(orgId: string, input: GapInput): Promise<void> {
  try {
    if (!orgId || !input.assetId) return;
    const q = (input.question ?? "").trim();
    if (!q) return;
    await ensureDb();
    // The gap signal is "none of the org's OWN documents were cited". Confidence
    // is deliberately NOT used: the OEM reference library and general knowledge
    // make the Copilot report high confidence even when the plant has uploaded
    // nothing of its own — so confidence never distinguishes a grounded answer
    // from an ungrounded one. Only a citation to the org's own document does.
    const ids = [...new Set((input.citedDocumentIds ?? []).filter(Boolean))];
    if (ids.length) {
      const owned = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.orgId, orgId), inArray(documents.id, ids)))
        .limit(1);
      if (owned.length) return; // grounded in the org's own document — not a gap
    }
    await db.insert(knowledgeGaps).values({
      id: id("gap"),
      orgId,
      assetId: input.assetId,
      question: q.slice(0, 500),
    });
  } catch {
    /* best-effort — a gap-logging failure must never affect the answer */
  }
}

export interface AssetGap {
  assetId: string;
  assetName: string;
  count: number;
  lastQuestion: string;
  lastAt: number;
}

// Aggregate gaps by machine, most-asked first — the upload priority list.
export async function listGapsByAsset(orgId: string, sinceDays = 180): Promise<AssetGap[]> {
  if (!orgId) throw new Error("listGapsByAsset() requires orgId");
  await ensureDb();
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const [rows, assetRows] = await Promise.all([
    db
      .select()
      .from(knowledgeGaps)
      .where(and(eq(knowledgeGaps.orgId, orgId), gte(knowledgeGaps.at, since)))
      .orderBy(desc(knowledgeGaps.at)),
    db.select({ id: assets.id, name: assets.name }).from(assets).where(eq(assets.orgId, orgId)),
  ]);
  const name = new Map(assetRows.map((a) => [a.id, a.name]));
  const byAsset = new Map<string, AssetGap>();
  for (const r of rows) {
    if (!r.assetId) continue;
    const at = r.at instanceof Date ? r.at.getTime() : Number(r.at);
    const g =
      byAsset.get(r.assetId) ??
      ({ assetId: r.assetId, assetName: name.get(r.assetId) ?? "Unknown machine", count: 0, lastQuestion: r.question, lastAt: at } as AssetGap);
    g.count++;
    if (at >= g.lastAt) { g.lastAt = at; g.lastQuestion = r.question; } // rows are desc → newest wins
    byAsset.set(r.assetId, g);
  }
  return [...byAsset.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, 20);
}
