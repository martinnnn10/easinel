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

// The org that open (no-auth) mode resolves the synthetic owner to. Defaults to
// the curated Demo Organization so sales demos work out of the box; set
// OPEN_MODE_ORG=production for a real single-customer deployment so the workspace
// is the genuine, empty-by-default Production Workspace instead of the demo data.
export function openModeOrgId(): string {
  return process.env.OPEN_MODE_ORG === "production" ? PROD_ORG : DEMO_ORG;
}

export function openModeOrgName(): string {
  return process.env.OPEN_MODE_ORG === "production" ? PROD_ORG_NAME : DEMO_ORG_NAME;
}
