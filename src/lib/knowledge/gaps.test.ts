import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import { db, ensureDb } from "@/lib/db";
import { documents, assets } from "@/lib/db/schema";
import { recordGapIfUngrounded, listGapsByAsset } from "./gaps";

const ORG = "org_gaps";

beforeAll(async () => {
  await ensureDb();
  await db.insert(assets).values([
    { id: "ast_g1", orgId: ORG, name: "Filler F1" },
    { id: "ast_g2", orgId: ORG, name: "Capper C2" },
  ]);
  // An org-owned document that WILL be cited for one question (so it's grounded).
  await db.insert(documents).values({ id: "doc_owned", orgId: ORG, filename: "F1 manual.pdf", kind: "manual" });
});

describe("recordGapIfUngrounded", () => {
  it("records a gap on an asset question with no org doc cited", async () => {
    await recordGapIfUngrounded(ORG, { assetId: "ast_g1", question: "why does F1 stall on start", citedDocumentIds: [] });
    const gaps = await listGapsByAsset(ORG);
    const g = gaps.find((x) => x.assetId === "ast_g1");
    expect(g).toBeTruthy();
    expect(g!.count).toBe(1);
    expect(g!.lastQuestion).toContain("stall on start");
  });

  it("does NOT record when the answer was grounded in the org's own document", async () => {
    await recordGapIfUngrounded(ORG, { assetId: "ast_g2", question: "capper torque spec", citedDocumentIds: ["doc_owned"] });
    const gaps = await listGapsByAsset(ORG);
    expect(gaps.some((x) => x.assetId === "ast_g2")).toBe(false);
  });

  it("does NOT record a question with no asset", async () => {
    await recordGapIfUngrounded(ORG, { assetId: null, question: "general q", citedDocumentIds: [] });
    const gaps = await listGapsByAsset(ORG);
    // ast_g2 has still never been recorded (it was only ever grounded above).
    expect(gaps.some((x) => x.assetId === "ast_g2")).toBe(false);
  });

  it("records even when the Copilot only cited another org's / OEM documents", async () => {
    // A citation the org does NOT own (OEM library or general knowledge) is not
    // grounding in the plant's own docs — it still counts as a gap.
    await recordGapIfUngrounded(ORG, { assetId: "ast_g2", question: "capper jam clearance", citedDocumentIds: ["doc_not_owned_oem"] });
    const gaps = await listGapsByAsset(ORG);
    expect(gaps.some((x) => x.assetId === "ast_g2")).toBe(true);
  });

  it("aggregates by machine (most-asked first) with the newest question surfaced", async () => {
    await recordGapIfUngrounded(ORG, { assetId: "ast_g1", question: "older F1 question" });
    await recordGapIfUngrounded(ORG, { assetId: "ast_g1", question: "newest F1 question" });
    const gaps = await listGapsByAsset(ORG);
    const g = gaps.find((x) => x.assetId === "ast_g1")!;
    expect(g.count).toBe(3);
    expect(g.assetName).toBe("Filler F1");
    expect(g.lastQuestion).toBe("newest F1 question");
    // Most-asked machine leads the list.
    expect(gaps[0].assetId).toBe("ast_g1");
  });

  it("is tenant-scoped — never returns another org's gaps", async () => {
    await recordGapIfUngrounded("org_other_gaps", { assetId: "ast_x", question: "secret" });
    const gaps = await listGapsByAsset(ORG);
    expect(gaps.every((g) => g.assetId !== "ast_x")).toBe(true);
  });
});
