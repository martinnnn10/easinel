// Demo-workspace identification — one centralized source of truth so the
// "sample data" labeling is consistent everywhere and never leaks into a real
// customer org. The EAS Demo Plant is a sales/training workspace populated with
// sample data (populate-demo-workspace.mjs); its metrics must never be mistaken
// for a customer's production results.
//
// Schema note: orgs has no demo flag today, so we match the known demo org by
// id (primary) or name (fallback, in case the demo org is re-created). If an
// org-level flag is added later (e.g. orgs.is_demo), switch this one function
// over and every banner/disclaimer follows.

// The platform's reserved Demo Organization tenant (mirrors DEMO_ORG /
// DEMO_ORG_NAME in @/lib/util — kept as literals here because this module is
// imported by client components and @/lib/util pulls in node:crypto).
const RESERVED_DEMO_ORG_ID = "org_demo";
const RESERVED_DEMO_ORG_NAME = "Demo Organization";
// The sales/training workspace convention used by the populate runbook.
export const DEMO_ORG_ID = "org_efed04ef-79ec-4e02-a6ac-d5a2fac7bd02"; // legacy id (back-compat)
export const DEMO_ORG_NAME = "EAS Demo Plant";

export interface OrgLike {
  id?: string | null;
  name?: string | null;
}

/**
 * True only for a demo/training workspace — never for a real customer org.
 * Matches the platform's reserved Demo Organization AND the sales-demo
 * convention, so the "sample data" labels fire in every demo context and in no
 * customer context. (No longer relies on a single stale hardcoded UUID.)
 */
export function isDemoOrg(org: OrgLike | null | undefined): boolean {
  if (!org) return false;
  return (
    org.id === RESERVED_DEMO_ORG_ID ||
    org.id === DEMO_ORG_ID ||
    org.name === RESERVED_DEMO_ORG_NAME ||
    org.name === DEMO_ORG_NAME
  );
}

// Routes where the app-shell demo banner must never appear: the public
// marketing site, the auth screens, and the full-screen at-the-machine view.
function isChromelessRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/field")
  );
}

/** Whether to show the app-shell demo banner: demo org AND an in-app route. */
export function shouldShowDemoBanner(org: OrgLike | null | undefined, pathname: string): boolean {
  return isDemoOrg(org) && !isChromelessRoute(pathname);
}
