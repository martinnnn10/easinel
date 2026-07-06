/**
 * Team contributions — a manager/admin view of WHO is doing the real work, so
 * dedication (especially sharing how a repair was done) can be recognized at
 * review time. Every credit is traced to a real person via the append-only
 * audit_log; nothing is invented. Actions that carry no real user identity
 * (system captures, anonymous "user" ingests) are counted as unattributed and
 * credited to no one — honesty over flattery.
 */

import { db, ensureDb } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { and, eq, gte, desc } from "drizzle-orm";

// The contribution categories we recognize, and which audit actions feed each.
// Only actions that carry a real user identity are listed here.
export type Category =
  | "scenariosShared"
  | "rcasSaved"
  | "workOrdersLogged"
  | "repairsClosed"
  | "approvals"
  | "pmsCreated"
  | "pmsCompleted"
  | "partsAdded"
  | "assetsAdded";

export const CATEGORY_LABEL: Record<Category, string> = {
  scenariosShared: "Scenarios shared",
  rcasSaved: "Root-cause analyses",
  workOrdersLogged: "Work orders logged",
  repairsClosed: "Repairs closed",
  approvals: "Approvals",
  pmsCreated: "PMs created",
  pmsCompleted: "PMs completed",
  partsAdded: "Parts added",
  assetsAdded: "Assets added",
};

// A single audit action maps to at most one category. `repairsClosed` and the
// generic `workorder.status_changed` need the detail payload, handled below.
const ACTION_CATEGORY: Record<string, Category> = {
  "scenario.created": "scenariosShared",
  "rca.saved": "rcasSaved",
  "workorder.created": "workOrdersLogged",
  "workorder.requested": "workOrdersLogged",
  "workorder.approved": "approvals",
  "pm.approved": "approvals",
  "pm.created": "pmsCreated",
  "pm.completed": "pmsCompleted",
  "part.created": "partsAdded",
  "asset.created": "assetsAdded",
};

// Knowledge-sharing signal — the dedication most worth praising: writing down
// how a problem was diagnosed and fixed so the next person doesn't relearn it.
const KNOWLEDGE: Category[] = ["scenariosShared", "rcasSaved", "repairsClosed"];

export interface PersonContribution {
  userId: string;
  name: string;
  email: string;
  role: string;
  counts: Record<Category, number>;
  total: number;
  knowledgeShared: number; // scenarios + RCAs + repairs closed
  lastActiveAt: number | null;
}

export interface RecentContribution {
  at: number;
  name: string | null; // null when unattributed
  role: string | null;
  category: Category | null;
  label: string; // human-readable "did X"
}

export interface ContributionsSummary {
  periodDays: number;
  people: PersonContribution[];
  totals: Record<Category, number>;
  totalCredited: number;
  unattributed: number; // events with no real user (system / anonymous)
  recent: RecentContribution[];
  hasData: boolean;
}

function emptyCounts(): Record<Category, number> {
  return {
    scenariosShared: 0, rcasSaved: 0, workOrdersLogged: 0, repairsClosed: 0,
    approvals: 0, pmsCreated: 0, pmsCompleted: 0, partsAdded: 0, assetsAdded: 0,
  };
}

// A short, past-tense phrase for the traceability feed.
function phrase(category: Category): string {
  switch (category) {
    case "scenariosShared": return "shared a scenario";
    case "rcasSaved": return "saved a root-cause analysis";
    case "workOrdersLogged": return "logged a work order";
    case "repairsClosed": return "closed a repair";
    case "approvals": return "approved work";
    case "pmsCreated": return "created a PM";
    case "pmsCompleted": return "completed a PM";
    case "partsAdded": return "added a part";
    case "assetsAdded": return "added an asset";
  }
}

// Map one audit row to a category, or null if it isn't a recognized contribution.
function categoryOf(action: string, detail: string | null): Category | null {
  if (action === "workorder.status_changed") {
    // Only a close-out (→ done) counts as a completed repair.
    try {
      const d = detail ? (JSON.parse(detail) as { to?: string }) : null;
      return d?.to === "done" ? "repairsClosed" : null;
    } catch {
      return null;
    }
  }
  return ACTION_CATEGORY[action] ?? null;
}

export async function getContributions(orgId: string, periodDays = 90): Promise<ContributionsSummary> {
  if (!orgId) throw new Error("getContributions() requires orgId");
  await ensureDb();
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Resolve actors → real users. audit_log.actor is a user id OR an email
  // depending on the call site, so index by both; case-insensitive on email.
  const members = await db.select().from(users).where(eq(users.orgId, orgId));
  const byId = new Map(members.map((u) => [u.id, u]));
  const byEmail = new Map(members.map((u) => [u.email.toLowerCase(), u]));
  const resolve = (actor: string) =>
    byId.get(actor) ?? byEmail.get(actor.toLowerCase()) ?? null;

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), gte(auditLog.at, periodStart)))
    .orderBy(desc(auditLog.at));

  const people = new Map<string, PersonContribution>();
  const totals = emptyCounts();
  let unattributed = 0;
  const recent: RecentContribution[] = [];

  for (const r of rows) {
    const category = categoryOf(r.action, r.detail);
    if (!category) continue; // not a recognized contribution action
    const user = resolve(r.actor);
    const at = r.at instanceof Date ? r.at.getTime() : Number(r.at);

    if (!user) {
      unattributed++;
      if (recent.length < 60) recent.push({ at, name: null, role: null, category, label: phrase(category) });
      continue;
    }

    let p = people.get(user.id);
    if (!p) {
      p = { userId: user.id, name: user.name, email: user.email, role: user.role, counts: emptyCounts(), total: 0, knowledgeShared: 0, lastActiveAt: null };
      people.set(user.id, p);
    }
    p.counts[category]++;
    p.total++;
    if (KNOWLEDGE.includes(category)) p.knowledgeShared++;
    if (p.lastActiveAt == null || at > p.lastActiveAt) p.lastActiveAt = at;
    totals[category]++;
    if (recent.length < 60) recent.push({ at, name: user.name, role: user.role, category, label: phrase(category) });
  }

  const peopleList = [...people.values()].sort(
    (a, b) => b.knowledgeShared - a.knowledgeShared || b.total - a.total
  );
  const totalCredited = peopleList.reduce((s, p) => s + p.total, 0);

  return {
    periodDays,
    people: peopleList,
    totals,
    totalCredited,
    unattributed,
    recent,
    hasData: totalCredited > 0,
  };
}
