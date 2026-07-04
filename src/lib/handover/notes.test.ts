import { describe, it, expect, beforeAll } from "vitest";
process.env.DATABASE_URL = ":memory:";

import { ensureDb } from "@/lib/db";
import { createHandoverNote, listHandoverNotes, resolveHandoverNote, deleteHandoverNote, buildNotesDigest } from "./notes";
import { createAsset } from "@/lib/assets/repository";

describe("shift handover notes (real entries, org-scoped)", () => {
  beforeAll(async () => { await ensureDb(); });

  it("stores a real note and lists it for the SAME org only", async () => {
    const orgA = "org_hand_a";
    const orgB = "org_hand_b";
    await createHandoverNote(orgA, "Tech Mike", {
      category: "machine_down", note: "Line 2 conveyor VFD tripping — left it locked out.", priority: "high",
    });
    const a = await listHandoverNotes(orgA);
    const b = await listHandoverNotes(orgB);
    expect(a.length).toBe(1);
    expect(a[0].note).toMatch(/conveyor VFD/);
    expect(a[0].createdBy).toBe("Tech Mike");
    expect(b.length).toBe(0); // cross-org isolation
  });

  it("drops a linked asset that belongs to a DIFFERENT org (no cross-tenant ref)", async () => {
    const orgA = "org_hand_c";
    const orgB = "org_hand_d";
    const bAsset = await createAsset(orgB, { name: "B Press", manufacturer: "X", model: "1" });
    const note = await createHandoverNote(orgA, "Tech", {
      category: "watch_item", note: "watch this", assetId: bAsset.id, // foreign asset
    });
    expect(note.assetId).toBeNull(); // link rejected — not org A's asset
  });

  it("builds a digest grouped by category from real entries", async () => {
    const org = "org_hand_e";
    await createHandoverNote(org, "T", { category: "safety", note: "Guard removed on saw — do not run.", priority: "critical" });
    await createHandoverNote(org, "T", { category: "parts_needed", note: "Need a PF525 5HP drive." });
    const notes = await listHandoverNotes(org);
    const digest = buildNotesDigest(notes);
    expect(digest).toContain("Safety concern");
    expect(digest).toContain("Parts needed");
    expect(digest).toContain("Guard removed");
    expect(digest).toContain("CRITICAL");
  });

  it("resolves and deletes notes (org-scoped)", async () => {
    const org = "org_hand_f";
    const n = await createHandoverNote(org, "T", { category: "watch_item", note: "temp fix on pump seal" });
    await resolveHandoverNote(org, n.id, true);
    let notes = await listHandoverNotes(org);
    expect(notes[0].status).toBe("resolved");
    await deleteHandoverNote(org, n.id);
    notes = await listHandoverNotes(org);
    expect(notes.length).toBe(0);
  });
});
