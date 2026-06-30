import { describe, it, expect, beforeAll } from "vitest";

// In-memory libSQL so the full close → capture → retrieve loop runs against the
// real SQL path. Set BEFORE importing the db module.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createWorkOrder,
  updateWorkOrder,
  transitionWorkOrder,
} from "./repository";
import { memoryDocId, captureWorkOrderMemory, hasCaptureContent } from "./memory";
import { createAsset, getAssetDigitalTwin } from "@/lib/assets/repository";
import { retrieve } from "@/lib/rag/retrieve";
import { db } from "@/lib/db";
import { documents, chunks } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const ORG = "org_mem_test";

async function memoryDocCount(orgId: string, woId: string): Promise<number> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, memoryDocId(woId))));
  return rows.length;
}
async function memoryChunkCount(orgId: string, woId: string): Promise<number> {
  const rows = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(eq(chunks.orgId, orgId), eq(chunks.documentId, memoryDocId(woId))));
  return rows.length;
}

describe("hasCaptureContent (pure guard)", () => {
  it("is true when any close-out field has content", () => {
    expect(hasCaptureContent({ resolution: "replaced fan" } as never)).toBe(true);
    expect(hasCaptureContent({ rootCause: "bearing" } as never)).toBe(true);
    expect(hasCaptureContent({ repairAction: "re-greased" } as never)).toBe(true);
  });
  it("is false for an empty / whitespace-only close-out", () => {
    expect(hasCaptureContent({} as never)).toBe(false);
    expect(hasCaptureContent({ resolution: "   ", rootCause: "" } as never)).toBe(false);
  });
});

describe("Maintenance Memory — capture on close (Slice 4)", () => {
  let assetId: string;

  beforeAll(async () => {
    // NOTE: test files share one in-memory libSQL db (the db client is memoized
    // on globalThis in non-production), so failure signals emitted by these
    // corrective closes are visible to other test files. Use a UNIQUE vendor so
    // these signals can never collide with another file's manufacturer-scoped
    // assertions (e.g. the Allen-Bradley signal test in repository.test.ts).
    const asset = await createAsset(ORG, {
      name: "Conveyor CV-09",
      assetTag: "CV-09",
      manufacturer: "MemtestVend",
      model: "MTV-900",
      assetType: "conveyor",
      site: "Plant 1",
      area: "Packaging",
    });
    assetId = asset.id;
  });

  it("indexes a closed corrective WO into a retrievable lesson scoped to the asset", async () => {
    const wo = await createWorkOrder(ORG, {
      title: "CV-09 tripping F007 after warm-up",
      symptom: "Drive faults F007 overload about 20 minutes after a cold start.",
      assetId,
      type: "corrective",
    });
    await transitionWorkOrder(ORG, wo.id, "in_progress");
    await updateWorkOrder(ORG, wo.id, {
      rootCause: "Panel cooling fan stalled; drive overheated and current climbed.",
      failedPart: "Panel cooling fan",
      repairAction: "Replaced cooling fan, cleaned filter.",
    });
    const res = await transitionWorkOrder(ORG, wo.id, "done", {
      resolution: "Replaced the stalled panel cooling fan; verified current held steady from cold start.",
    });
    expect(res.workOrder?.status).toBe("done");

    // A single memory document exists for this work order.
    expect(await memoryDocCount(ORG, wo.id)).toBe(1);
    expect(await memoryChunkCount(ORG, wo.id)).toBeGreaterThan(0);

    // The Copilot's retriever surfaces the captured repair for a GENERAL question
    // (no asset id named) — the gap Slice 4 closes.
    const hits = await retrieve("cooling fan overload after warm up", { orgId: ORG, limit: 5 });
    const joined = hits.map((h) => `${h.filename} ${h.content}`.toLowerCase()).join(" ");
    expect(joined).toContain("cooling fan");
    expect(hits.some((h) => h.kind === "lesson")).toBe(true);
  });

  it("surfaces the captured memory in the asset digital twin Lessons tab", async () => {
    const wo = await createWorkOrder(ORG, {
      title: "CV-09 bearing seizure",
      assetId,
      type: "corrective",
    });
    await transitionWorkOrder(ORG, wo.id, "done", {
      resolution: "Drive-end bearing seized; replaced bearing and re-greased.",
    });
    const twin = await getAssetDigitalTwin(ORG, assetId);
    expect(twin).toBeDefined();
    const lesson = twin!.lessons.find((l) => l.id === memoryDocId(wo.id));
    expect(lesson).toBeDefined();
    expect(lesson!.kind).toBe("lesson");
  });

  it("is idempotent: reopen → reclose REPLACES the memory, never duplicates", async () => {
    const wo = await createWorkOrder(ORG, {
      title: "CV-09 jam at transfer",
      assetId,
      type: "corrective",
    });
    await transitionWorkOrder(ORG, wo.id, "done", { resolution: "Cleared jam; adjusted transfer plate." });
    expect(await memoryDocCount(ORG, wo.id)).toBe(1);
    const firstChunks = await memoryChunkCount(ORG, wo.id);
    expect(firstChunks).toBeGreaterThan(0);

    // Reopen and re-close with a different, longer resolution.
    await transitionWorkOrder(ORG, wo.id, "open", { note: "reopened, jam recurred" });
    await transitionWorkOrder(ORG, wo.id, "done", {
      resolution:
        "Transfer plate was worn through; replaced the plate and re-set the gap. Jam root cause was the worn plate, not the conveyor itself.",
    });

    // Still exactly one memory doc (replaced, not duplicated).
    expect(await memoryDocCount(ORG, wo.id)).toBe(1);

    // And it reflects the latest close-out content.
    const hits = await retrieve("worn transfer plate replaced gap", { orgId: ORG, limit: 5 });
    const joined = hits.map((h) => h.content.toLowerCase()).join(" ");
    expect(joined).toContain("transfer plate");
  });

  it("does NOT capture a bare close with no close-out content", async () => {
    const wo = await createWorkOrder(ORG, {
      title: "CV-09 quick reset",
      assetId,
      type: "corrective",
    });
    await transitionWorkOrder(ORG, wo.id, "done"); // no resolution / root cause / repair action
    expect(await memoryDocCount(ORG, wo.id)).toBe(0);
  });

  it("captureWorkOrderMemory is tenant-scoped (no cross-org leak)", async () => {
    const wo = await createWorkOrder(ORG, {
      title: "CV-09 scoped check",
      assetId,
      type: "corrective",
    });
    const closed = await transitionWorkOrder(ORG, wo.id, "done", { resolution: "Tenant scope check resolution." });
    await captureWorkOrderMemory(ORG, closed.workOrder!, "CV-09");
    // A different org must not see this org's memory document.
    expect(await memoryDocCount("org_other_tenant", wo.id)).toBe(0);
  });
});
