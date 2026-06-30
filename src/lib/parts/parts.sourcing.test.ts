import { describe, it, expect } from "vitest";

// In-memory libSQL so the repository exercises the real SQL path. MUST be set
// before importing the db module.
process.env.DATABASE_URL = ":memory:";
process.env.EMBEDDINGS_DISABLED = "1";

import {
  createPart,
  getPart,
  updatePart,
  addAlias,
  listAliases,
  getFieldMemory,
  linkAsset,
  linkPm,
  recordFailedPart,
  addSupplier,
  listSuppliers,
  searchParts,
} from "./repository";
import { smartSearch, findCompatible } from "./search";
import { createWorkOrder } from "@/lib/workorders/repository";
import { createProgram } from "@/lib/pm/repository";
import { can } from "@/lib/auth/roles";

// Each test gets a fresh, unique organization so assertions are deterministic
// AND so the suite doubles as a tenancy check (no test can see another's data).
let n = 0;
const freshOrg = () => `org_test_${Date.now()}_${n++}`;

describe("Parts Sourcing — tenancy isolation", () => {
  it("getPart/searchParts/getFieldMemory never cross org boundaries", async () => {
    const A = freshOrg(), B = freshOrg();
    const a = await createPart(A, { description: "Bearing 6206-2RS", partNumber: "6206-2RS", manufacturer: "SKF", category: "Bearing" });
    await createPart(B, { description: "Org B private bearing", partNumber: "9999", category: "Bearing" });

    expect(await getPart(B, a.id)).toBeUndefined();
    expect(await getFieldMemory(B, a.id)).toBeNull();

    expect((await searchParts(B, "6206")).find((r) => r.id === a.id)).toBeUndefined();
    expect((await searchParts(A, "6206")).find((r) => r.id === a.id)).toBeDefined();
  });

  it("every repository function hard-errors without an orgId", async () => {
    await expect(createPart("", { description: "x" })).rejects.toThrow(/orgId/);
    await expect(getPart("", "p")).rejects.toThrow(/orgId/);
    await expect(smartSearch("", "x")).rejects.toThrow(/orgId/);
  });

  it("mutations and links cannot leak across tenants", async () => {
    const A = freshOrg(), B = freshOrg();
    const a = await createPart(A, { description: "Org A contactor", category: "Contactor / Relay" });
    expect(await updatePart(B, a.id, { description: "hijacked" }, "attacker")).toBeUndefined();
    expect((await getPart(A, a.id))!.description).toBe("Org A contactor");
    expect(await addAlias(B, a.id, "X", "alt_pn")).toBeUndefined();
    expect((await listAliases(A, a.id)).length).toBe(0);
  });
});

describe("Parts Sourcing — search (messy / fuzzy input)", () => {
  it("detects manufacturer and category, exact part-number = high confidence", async () => {
    const A = freshOrg();
    await createPart(A, { description: "PowerFlex 525 drive", partNumber: "25B-D017N104", manufacturer: "Allen-Bradley", category: "VFD / Drive" });
    const r = await smartSearch(A, "25B-D017N104");
    expect(r.detectedManufacturer).toBe("Allen-Bradley");
    expect(r.bestMatch?.confidence).toBe("high");
    expect(r.weak).toBe(false);
    expect(r.bestMatch?.evidence.join(" ")).toMatch(/Exact part-number/);
  });

  it("messy spacing/dashes still matches the part number", async () => {
    const A = freshOrg();
    await createPart(A, { description: "PowerFlex 525 drive", partNumber: "25B-D017N104", manufacturer: "Allen-Bradley", category: "VFD / Drive" });
    const r = await smartSearch(A, "25b d017 n104");
    expect(r.bestMatch?.part.partNumber).toBe("25B-D017N104");
  });

  it("plain-language description search works", async () => {
    const A = freshOrg();
    await createPart(A, { description: "Blue photoeye sensor for conveyor", manufacturer: "Allen-Bradley", category: "Sensor" });
    const r = await smartSearch(A, "blue photoeye on conveyor 3");
    expect(r.inferredCategory).toBe("Sensor");
    expect(r.bestMatch?.part.description).toMatch(/photoeye/i);
  });

  it("an unmatchable search is flagged weak and honest, not a confident guess", async () => {
    const A = freshOrg();
    await createPart(A, { description: "Some unrelated motor", category: "Motor" });
    const r = await smartSearch(A, "nonexistent flux capacitor zzz");
    expect(r.weak).toBe(true);
    expect(r.bestMatch === null || r.bestMatch.confidence === "low").toBe(true);
    expect(r.note).toBeTruthy();
  });
});

describe("Parts Sourcing — aliases & compatibility", () => {
  it("a part is found via its alias", async () => {
    const A = freshOrg();
    const p = await createPart(A, { description: "Drive-end bearing", partNumber: "AAA111", category: "Bearing" });
    await addAlias(A, p.id, "ZZZ-OEM-9", "oem");
    const r = await smartSearch(A, "ZZZ-OEM-9");
    expect(r.bestMatch?.part.id).toBe(p.id);
    expect(r.bestMatch?.evidence.join(" ")).toMatch(/alias/i);
  });

  it("compatible replacements share category; cross-category items are excluded", async () => {
    const A = freshOrg();
    const base = await createPart(A, { description: "Bearing A", partNumber: "AAA", manufacturer: "SKF", category: "BearingCompat" });
    await createPart(A, { description: "Bearing B (same category)", partNumber: "BBB", manufacturer: "SKF", category: "BearingCompat" });
    await createPart(A, { description: "A sensor (different category)", partNumber: "SEN", manufacturer: "SKF", category: "Sensor" });
    const compat = await findCompatible(A, base.id);
    expect(compat.length).toBe(1);
    expect(compat[0].reasons[0]).toMatch(/Same category/);
  });
});

describe("Parts Sourcing — work order & PM linkage (Field Memory)", () => {
  it("recording failed parts builds failure history and triggers stocking suggestion", async () => {
    const A = freshOrg();
    const part = await createPart(A, { description: "Repeat-failure motor", category: "Motor" });
    const wo1 = await createWorkOrder(A, { title: "Motor down #1", type: "corrective" });
    const wo2 = await createWorkOrder(A, { title: "Motor down #2", type: "corrective" });

    const r1 = await recordFailedPart(A, { workOrderId: wo1.id, partId: part.id });
    expect(r1.failureCount).toBe(1);
    expect(r1.suggestCriticalSpare).toBe(false);

    const r2 = await recordFailedPart(A, { workOrderId: wo2.id, partId: part.id });
    expect(r2.failureCount).toBe(2);
    expect(r2.suggestCriticalSpare).toBe(true);
    expect(r2.suggestPmInspection).toBe(true);

    const mem = await getFieldMemory(A, part.id);
    expect(mem!.failure.failureCount).toBe(2);
    expect(mem!.workOrders.filter((w) => w.role === "failed").length).toBe(2);
  });

  it("PM links surface in Field Memory; asset links record where used", async () => {
    const A = freshOrg();
    const part = await createPart(A, { description: "Inspected belt", category: "Belt" });
    const pm = await createProgram(A, { title: "Monthly belt check", intervalDays: 30 }, "mgr");
    await linkPm(A, part.id, pm.id);
    await linkAsset(A, part.id, "asset_xyz", "main drive");
    const mem = await getFieldMemory(A, part.id);
    expect(mem!.pms.length).toBe(1);
    expect(mem!.assets.length).toBe(1);
    expect(mem!.assets[0].position).toBe("main drive");
  });
});

describe("Parts Sourcing — suppliers & RBAC", () => {
  it("suppliers are org-scoped and stored as entered (no fake pricing)", async () => {
    const A = freshOrg(), B = freshOrg();
    const part = await createPart(A, { description: "Sourced valve", category: "Valve" });
    await addSupplier(A, part.id, { name: "Acme Supply", leadTime: "3-5 days" });
    const sup = await listSuppliers(A, part.id);
    expect(sup.length).toBe(1);
    expect(sup[0].name).toBe("Acme Supply");
    expect(sup[0].price).toBeNull();
    expect((await listSuppliers(B, part.id)).length).toBe(0);
  });

  it("RBAC: viewers can view but cannot manage parts; managing roles can", () => {
    expect(can("viewer", "view")).toBe(true);
    expect(can("viewer", "manage_parts")).toBe(false);
    for (const role of ["owner", "admin", "manager", "technician"] as const) {
      expect(can(role, "manage_parts")).toBe(true);
    }
  });
});
