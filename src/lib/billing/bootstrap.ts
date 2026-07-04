/**
 * Bootstrap billing for existing orgs.
 * Called once during app startup — creates a "grandfathered" subscription
 * for any org that already has users but no subscription row.
 * This ensures the original owner is never locked out by the paywall.
 */

import { db, ensureDb } from "@/lib/db";
import { orgs, users, subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createGrandfatheredSubscription } from "./subscription";
import { isReservedOrg } from "@/lib/util";

let bootstrapped = false;

export async function bootstrapBilling(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  await ensureDb();

  // Find all orgs that have users but no subscription
  const allOrgs = await db.select().from(orgs);
  for (const org of allOrgs) {
    if (isReservedOrg(org.id)) continue;

    // Check if this org has any users
    const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.orgId, org.id));
    if (orgUsers.length === 0) continue;

    // Check if this org already has a subscription
    const existingSub = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, org.id));
    if (existingSub.length > 0) continue;

    // Grandfather this org
    await createGrandfatheredSubscription(org.id);
    console.log(`[billing/bootstrap] Grandfathered org ${org.id} (${org.name})`);
  }
}
