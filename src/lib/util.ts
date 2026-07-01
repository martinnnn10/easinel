import { randomUUID } from "crypto";

export function id(prefix = ""): string {
  const u = randomUUID();
  return prefix ? `${prefix}_${u}` : u;
}

// Reserved org id for the curated, isolated Demo Organization tenant used for
// sales demos and open (no-auth) mode. Real customer orgs never use this id.
export const DEMO_ORG = "org_demo";
export const DEMO_ORG_NAME = "Demo Organization";

// Reserved org id for the real PRODUCTION workspace used in open (no-auth) mode
// when the deployment is run for a single real customer rather than as a sales
// demo. It is a genuine, isolated workspace that starts EMPTY (no curated demo
// data) and accumulates the customer's own assets, work orders, parts, and
// uploaded documents. Selected at runtime via OPEN_MODE_ORG=production.
export const PROD_ORG = "org_prod";
export const PROD_ORG_NAME = "Production Workspace";

// Reserved sentinel org id for GLOBAL platform knowledge (the OEM reference
// library) that every tenant can retrieve but no tenant owns or can mutate.
// This data carries no tenant-private information — only generic manufacturer
// fault/fix knowledge — so sharing it across orgs is safe and is the core of
// the product's day-one grounding value.
export const GLOBAL_ORG = "__global__";

// The non-routable sentinel used as the column-level default for org_id, so a
// row inserted without an explicit org can never silently join a real tenant.
export const UNSET_ORG = "__unset__";

// Reserved org ids that real customer tenants may NEVER be assigned, and that an
// authenticated CUSTOMER session may never resolve to. The Demo Organization is
// treated as a fully separate tenant: impossible to reach from a customer org.
export const RESERVED_ORG_IDS: readonly string[] = [DEMO_ORG, PROD_ORG, GLOBAL_ORG, UNSET_ORG];

export function isReservedOrg(orgId: string | null | undefined): boolean {
  return !!orgId && RESERVED_ORG_IDS.includes(orgId);
}

// Demo mode is OFF by default. A real deployment starts with an EMPTY Production
// Workspace and NEVER shows curated demo data (e.g. "Conveyor 3", "Pump 12").
// The isolated sales demo is strictly OPT-IN — enable it explicitly with any of:
//   • DEMO_MODE=true
//   • OPEN_MODE_ORG=demo
//   • SEED_DEMO_ORG=true   (kept for backward-compat; implies demo mode)
// This makes "a real customer/operator ever sees a canned scenario" impossible
// unless someone deliberately turns the demo on.
export function demoModeEnabled(): boolean {
  return (
    process.env.DEMO_MODE === "true" ||
    process.env.OPEN_MODE_ORG === "demo" ||
    process.env.SEED_DEMO_ORG === "true"
  );
}

// The org that open (no-auth) mode resolves the synthetic owner to. DEFAULTS to
// the genuine, empty Production Workspace so equipment starts clean. Only the
// explicit demo opt-in (demoModeEnabled) points open mode at the curated Demo
// Organization that holds the sales dataset.
export function openModeOrgId(): string {
  return demoModeEnabled() ? DEMO_ORG : PROD_ORG;
}

export function openModeOrgName(): string {
  return demoModeEnabled() ? DEMO_ORG_NAME : PROD_ORG_NAME;
}
