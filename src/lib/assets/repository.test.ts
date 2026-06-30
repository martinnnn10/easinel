import { describe, it, expect, beforeAll } from "vitest";

// Integration-style tests against a real in-memory libSQL DB. We point
// DATABASE_URL at an in-memory database BEFORE importing the db module so the
// repository exercises the actual SQL path (and the future Postgres swap would
// reuse these same assertions against its own connection).
process.env.DATABASE_URL = ":memory:"; // libSQL accepts :memory:
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createAsset,
  updateAsset,
  deleteAsset,
  getAsset,
  listAssets,
  addAlarmEvent,
  addAssetPhoto,
  listAssetPhotos,
  getAssetDigitalTwin,
  buildAssetContext,
} from "./repository";
const ORG = "org_test";

const DAY = 86400_000;

describe("asset repository", () => {
  beforeAll(async () => {
    // touch the db so the schema is created
    await listAssets(ORG);
  });

  it("creates, reads, updates and lists assets with rich fields", async () => {
    const created = await createAsset(
      ORG,
      {
        name: "Test Press 9",
        assetTag: "PR-09",
        site: "Plant B",
        area: "Stamping",
        manufacturer: "Schuler",
        model: "MSP-400",
        assetType: "press",
        status: "operational",
        criticality: "high",
      },
      "tester@local"
    );
    expect(created.id).toMatch(/^ast_/);
    expect(created.site).toBe("Plant B");
    expect(created.status).toBe("operational");

    const fetched = await getAsset(ORG, created.id);
    expect(fetched?.name).toBe("Test Press 9");

    const updated = await updateAsset(ORG, created.id, { status: "down", notes: "Ram stuck" }, "tester@local");
    expect(updated?.status).toBe("down");
    expect(updated?.notes).toBe("Ram stuck");

    const byFilter = await listAssets(ORG, { status: "down" });
    expect(byFilter.some((a) => a.id === created.id)).toBe(true);

    const search = await listAssets(ORG, { search: "schuler" });
    expect(search.some((a) => a.id === created.id)).toBe(true);
  });

  it("rejects invalid status/criticality on update (keeps prior value)", async () => {
    const a = await createAsset(ORG, { name: "Guarded", status: "operational" });
    const r = await updateAsset(ORG, a.id, { status: "exploded" as never });
    expect(r?.status).toBe("operational");
  });

  it("records alarms and computes reliability metrics", async () => {
    const a = await createAsset(ORG, { name: "Metric Asset", criticality: "high" });
    const now = Date.now();
    await addAlarmEvent(ORG, a.id, { code: "F007", message: "Overload", severity: "fault", occurredAt: now - 40 * DAY });
    await addAlarmEvent(ORG, a.id, { code: "F007", message: "Overload again", severity: "fault", occurredAt: now - 10 * DAY });
    await addAlarmEvent(ORG, a.id, { code: "F081", message: "Comm warning", severity: "warning", occurredAt: now - 5 * DAY });

    const twin = await getAssetDigitalTwin(ORG, a.id);
    expect(twin).toBeDefined();
    expect(twin!.alarmEvents.length).toBe(3);
    // two F007 faults => failureCount >= 2, recurring fault detected
    expect(twin!.metrics.failureCount).toBeGreaterThanOrEqual(2);
    expect(twin!.metrics.recurringFaults.find((f) => f.key === "F007")?.count).toBe(2);
    expect(twin!.metrics.daysSinceLastFault).toBeGreaterThanOrEqual(9);
    // suggested PM interval derived from MTBF/2
    expect(twin!.metrics.suggestedPMIntervalDays).toBeGreaterThanOrEqual(7);
  });

  it("adds a photo and sets it as the primary image when none exists", async () => {
    const a = await createAsset(ORG, { name: "Photo Asset" });
    expect(a.imagePath).toBeNull();
    const photo = await addAssetPhoto(ORG, a.id, { storagePath: "/tmp/x.jpg", caption: "nameplate" });
    expect(photo?.id).toMatch(/^aph_/);
    const refetched = await getAsset(ORG, a.id);
    expect(refetched?.imagePath).toBe("/tmp/x.jpg");
    const photos = await listAssetPhotos(ORG, a.id);
    expect(photos.length).toBe(1);
  });

  it("builds a rich AI context string", async () => {
    const a = await createAsset(ORG, {
      name: "Context Asset",
      manufacturer: "Allen-Bradley",
      model: "PowerFlex 525",
      site: "Plant A",
      area: "Packaging",
    });
    await addAlarmEvent(ORG, a.id, { code: "F012", message: "OverCurrent", severity: "fault" });
    const ctx = await buildAssetContext(ORG, a.id);
    expect(ctx).toContain("Context Asset");
    expect(ctx).toContain("Allen-Bradley PowerFlex 525");
    expect(ctx).toContain("Plant A");
    expect(ctx).toContain("F012");
  });

  it("deletes an asset and its owned rows", async () => {
    const a = await createAsset(ORG, { name: "Doomed" });
    await addAlarmEvent(ORG, a.id, { message: "blip" });
    const ok = await deleteAsset(ORG, a.id, "tester@local");
    expect(ok).toBe(true);
    expect(await getAsset(ORG, a.id)).toBeUndefined();
  });
});
