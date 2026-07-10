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

export const DEMO_ORG_ID = "org_efed04ef-79ec-4e02-a6ac-d5a2fac7bd02";
export const DEMO_ORG_NAME = "EAS Demo Plant";

export interface OrgLike {
  id?: string | null;
  name?: string | null;
}

/** True only for the labeled demo workspace — never for a real customer org. */
export function isDemoOrg(org: OrgLike | null | undefined): boolean {
  if (!org) return false;
  return org.id === DEMO_ORG_ID || org.name === DEMO_ORG_NAME;
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
