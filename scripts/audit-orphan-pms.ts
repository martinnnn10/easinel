/**
 * Orphan-PM audit.
 *
 * New orphan PMs are now impossible — createProgram() rejects a program with no
 * asset, and every generation/manual/suggestion path resolves or creates the
 * machine first. This script finds any LEGACY PMs (created before that rule) that
 * still have no asset, so they can be assigned to a machine.
 *
 *   npm run audit:orphan-pms
 *
 * Read-only: it reports, it does not modify data.
 */
import { db, ensureDb } from "../src/lib/db";
import { pmPrograms } from "../src/lib/db/schema";
import { isNull, or, eq } from "drizzle-orm";

async function main() {
  await ensureDb();
  const orphans = await db
    .select({
      id: pmPrograms.id,
      orgId: pmPrograms.orgId,
      title: pmPrograms.title,
      status: pmPrograms.status,
      createdAt: pmPrograms.createdAt,
    })
    .from(pmPrograms)
    .where(or(isNull(pmPrograms.assetId), eq(pmPrograms.assetId, "")));

  if (orphans.length === 0) {
    console.log("✓ No orphan PMs. Every PM program belongs to a machine.");
    return;
  }

  const byOrg = new Map<string, typeof orphans>();
  for (const o of orphans) {
    const list = byOrg.get(o.orgId) ?? [];
    list.push(o);
    byOrg.set(o.orgId, list);
  }

  console.log(`⚠ Found ${orphans.length} orphan PM program(s) with no asset:\n`);
  for (const [orgId, list] of byOrg) {
    console.log(`  org ${orgId} — ${list.length} orphan(s):`);
    for (const o of list) {
      const when = new Date(Number(o.createdAt)).toISOString().slice(0, 10);
      console.log(`    • [${o.status}] ${o.title}  (${o.id}, created ${when})`);
    }
    console.log("");
  }
  console.log("Assign each to a machine (the PM detail page can reassign), or archive it.");
  process.exitCode = 1; // non-zero so CI can flag legacy orphans
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(2);
});
