"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";

type Category =
  | "scenariosShared" | "rcasSaved" | "workOrdersLogged" | "repairsClosed"
  | "approvals" | "pmsCreated" | "pmsCompleted" | "partsAdded" | "assetsAdded";

interface Person {
  userId: string;
  name: string;
  email: string;
  role: string;
  counts: Record<Category, number>;
  total: number;
  knowledgeShared: number;
  lastActiveAt: number | null;
}
interface Recent {
  at: number;
  name: string | null;
  role: string | null;
  category: Category | null;
  label: string;
}
interface Summary {
  periodDays: number;
  people: Person[];
  totals: Record<Category, number>;
  totalCredited: number;
  unattributed: number;
  recent: Recent[];
  hasData: boolean;
}

const CAT_LABEL: Record<Category, string> = {
  scenariosShared: "Scenarios", rcasSaved: "Root-cause analyses", workOrdersLogged: "Work orders",
  repairsClosed: "Repairs closed", approvals: "Approvals", pmsCreated: "PMs created",
  pmsCompleted: "PMs done", partsAdded: "Parts", assetsAdded: "Assets",
};
// Order the chips so the knowledge-sharing metrics lead.
const CHIP_ORDER: Category[] = [
  "scenariosShared", "rcasSaved", "repairsClosed", "workOrdersLogged",
  "pmsCreated", "pmsCompleted", "approvals", "partsAdded", "assetsAdded",
];

const roleColor: Record<string, string> = {
  owner: "var(--color-accent)", admin: "var(--color-accent)",
  manager: "var(--color-amber)", technician: "var(--color-green)", viewer: "var(--color-faint)",
};

function relTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function ContributionsPage() {
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [period, setPeriod] = useState(90);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/contributions?days=${period}`)
      .then((r) => { if (r.status === 401 || r.status === 403) { setForbidden(true); return null; } return r.json(); })
      .then((j) => j && setD(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  const top = d?.people.find((p) => p.knowledgeShared > 0) ?? null;

  return (
    <>
      <TopBar
        title="Team Contributions"
        subtitle="Who's building the plant's memory — recognize dedication, trace every action to a person"
        right={
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="text-[12px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5"
          >
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
          </select>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {loading ? (
            <div className="h-40 rounded-2xl bg-[var(--color-surface-2)] animate-pulse" />
          ) : forbidden ? (
            <div className="text-center py-20">
              <div className="text-3xl mb-3">🔒</div>
              <p className="text-[15px] font-medium">Contributions is for managers &amp; admins</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-sm mx-auto">
                This recognition view is available to your organization&apos;s managers, admins, and owner.
              </p>
              <Link href="/today" className="inline-block mt-5 text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-4 py-2 hover:brightness-110">
                Back to Today
              </Link>
            </div>
          ) : !d ? (
            <p className="text-[var(--color-muted)] text-sm">Couldn&apos;t load contributions.</p>
          ) : !d.hasData ? (
            <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-2xl">
              <div className="text-3xl mb-3">👏</div>
              <p className="text-[15px] font-medium">No tracked contributions yet</p>
              <p className="text-[var(--color-muted)] text-sm mt-1 max-w-md mx-auto">
                As your team logs work, shares scenarios, closes repairs, and completes PMs, every
                action is credited to the person who did it — here, ready for review time.
              </p>
            </div>
          ) : (
            <>
              {/* Recognition hero — the top knowledge sharer */}
              {top && (
                <div className="rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-surface-2)]/40 p-5 mb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                    🏆 Top knowledge sharer · {period <= 30 ? "last 30 days" : period <= 90 ? "last 90 days" : period <= 180 ? "last 6 months" : "last year"}
                  </p>
                  <div className="flex items-center gap-3.5 mt-3">
                    <div className="w-12 h-12 rounded-full bg-[var(--color-accent)]/15 grid place-items-center text-[16px] font-semibold text-[var(--color-accent)] shrink-0">
                      {initials(top.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[17px] font-semibold">{top.name}</p>
                      <p className="text-[13px] text-[var(--color-muted)]">
                        {top.knowledgeShared} knowledge {top.knowledgeShared === 1 ? "contribution" : "contributions"}
                        {top.counts.scenariosShared > 0 ? ` · ${top.counts.scenariosShared} scenario${top.counts.scenariosShared === 1 ? "" : "s"}` : ""}
                        {top.counts.repairsClosed > 0 ? ` · ${top.counts.repairsClosed} repair${top.counts.repairsClosed === 1 ? "" : "s"} documented` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="text-[12px] text-[var(--color-faint)] mt-3">
                    Sharing how a fix was done is what stops the plant solving the same breakdown twice.
                    Worth calling out at review time.
                  </p>
                </div>
              )}

              {/* Leaderboard */}
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                Contributions by person
              </h2>
              <div className="space-y-2.5">
                {d.people.map((p) => (
                  <div key={p.userId} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[var(--color-surface-2)] grid place-items-center text-[12px] font-semibold shrink-0" style={{ color: roleColor[p.role] ?? "var(--color-text)" }}>
                        {initials(p.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-semibold truncate">{p.name}</p>
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ color: roleColor[p.role] ?? "var(--color-muted)", background: "var(--color-surface-2)" }}>
                            {p.role}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--color-faint)]">
                          {p.total} total {p.total === 1 ? "action" : "actions"}
                          {p.lastActiveAt ? ` · last active ${relTime(p.lastActiveAt)}` : ""}
                        </p>
                      </div>
                      {p.knowledgeShared > 0 && (
                        <span className="text-[11px] font-medium text-[var(--color-accent)] shrink-0">
                          {p.knowledgeShared} knowledge
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {CHIP_ORDER.filter((c) => p.counts[c] > 0).map((c) => (
                        <span key={c} className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border-soft)] bg-[var(--color-surface-2)]/50 text-[var(--color-muted)]">
                          {CAT_LABEL[c]} <strong className="text-[var(--color-text)]">{p.counts[c]}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Traceability feed */}
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mt-7 mb-2">
                Recent activity — who did what
              </h2>
              <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                {d.recent.slice(0, 40).map((r, i) => (
                  <div key={i} className={`flex items-center gap-2.5 px-4 py-2.5 text-[13px] ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.name ? "var(--color-accent)" : "var(--color-faint)" }} />
                    <span className="flex-1 min-w-0 truncate">
                      <strong className="font-medium">{r.name ?? "Automated / unattributed"}</strong>{" "}
                      <span className="text-[var(--color-muted)]">{r.label}</span>
                    </span>
                    <span className="text-[11px] text-[var(--color-faint)] shrink-0">{relTime(r.at)}</span>
                  </div>
                ))}
              </div>
              {d.unattributed > 0 && (
                <p className="text-[11.5px] text-[var(--color-faint)] mt-2">
                  {d.unattributed} action{d.unattributed === 1 ? "" : "s"} in this period were automated or
                  couldn&apos;t be traced to a specific person, so they&apos;re credited to no one.
                </p>
              )}
              <p className="text-[11px] text-[var(--color-faint)] mt-6 text-center">
                Every credit here is traced to a real person via the audit log. Nothing is estimated.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
