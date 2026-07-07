"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode };

// Navigation grouped for a calm maintenance OS, not a flat pile of modules:
// Daily (the shift's working loop) → Maintenance (planning) → Advanced (occasional
// tools) → Admin. Grouping only reduces visual clutter — every route stays
// reachable; nothing is removed. Advanced/Admin render visually quieter so the
// daily workflow leads.
const navGroups: { title: string; muted?: boolean; collapsible?: boolean; items: NavItem[] }[] = [
  {
    title: "Daily",
    items: [
      { href: "/today", label: "Today", icon: BoardIcon },
      { href: "/copilot", label: "Copilot", icon: SparkIcon },
      { href: "/work-orders", label: "Work Orders", icon: WrenchIcon },
      { href: "/handover", label: "Shift Handover", icon: PulseIcon },
    ],
  },
  {
    title: "Maintenance",
    items: [
      { href: "/assets", label: "Equipment", icon: CubeIcon },
      { href: "/pm", label: "PM Program", icon: CalendarIcon },
      { href: "/parts", label: "Parts", icon: BoltIcon },
      { href: "/knowledge", label: "Knowledge", icon: BookIcon },
    ],
  },
  {
    title: "Advanced",
    muted: true,
    // Occasional/supervisor tools. Collapsed by default for daily floor users
    // (technician/viewer) so their sidebar leads with the five things they
    // actually use; everything stays one click away.
    collapsible: true,
    items: [
      { href: "/plc", label: "PLC Explorer", icon: ChipIcon },
      { href: "/scenarios", label: "Scenarios", icon: BookIcon },
      { href: "/sessions", label: "Sessions", icon: PulseIcon },
      { href: "/dashboard", label: "Dashboard", icon: ChartIcon },
      { href: "/help", label: "How-To", icon: HelpIcon },
    ],
  },
];

const STORAGE_KEY = "eas_sidebar_collapsed";

interface Me {
  user: { name: string; email: string; role: string } | null;
  authRequired: boolean;
  workspaceMode?: "production" | "demo";
  org?: { id: string; name: string } | null;
}

export function Sidebar() {
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // "Advanced" group open/closed. Defaults collapsed for technician/viewer;
  // a manual toggle is remembered. null = not yet resolved (render open).
  const [advancedOpen, setAdvancedOpen] = useState<boolean | null>(null);

  // Restore the user's collapse preference (desktop).
  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => {});
  }, [path]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  // Resolve the "Advanced" default once we know the role: collapsed for daily
  // floor users (technician/viewer), open for supervisors+. A saved manual
  // toggle always wins.
  useEffect(() => {
    if (!me?.user) return;
    try {
      const saved = localStorage.getItem("eas_nav_advanced");
      if (saved === "1" || saved === "0") {
        setAdvancedOpen(saved === "1");
        return;
      }
    } catch {
      /* ignore */
    }
    const lowPriv = me.user.role === "technician" || me.user.role === "viewer";
    setAdvancedOpen(!lowPriv);
  }, [me]);

  const toggleAdvanced = () => {
    setAdvancedOpen((o) => {
      const next = !(o ?? true);
      try {
        localStorage.setItem("eas_nav_advanced", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // No sidebar on the public marketing site (/) or the login screen — the app
  // chrome belongs to the logged-in experience only.
  // /field is the full-screen at-the-machine capture view — no app chrome.
  if (path === "/" || path === "/privacy" || path === "/terms" || path.startsWith("/login") || path.startsWith("/field")) return null;

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const isAdmin =
    me?.authRequired &&
    (me?.user?.role === "owner" || me?.user?.role === "admin");
  // Recognition/traceability is a manager tool too, not just admin.
  const isManagerPlus = isAdmin || (me?.authRequired && me?.user?.role === "manager");

  const width = collapsed ? "md:w-[64px]" : "md:w-[230px]";

  return (
    <>
      {/* Mobile hamburger */}
      <button
        aria-label="Open menu"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-40 w-9 h-9 grid place-items-center rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-muted)]"
      >
        <MenuIcon className="w-5 h-5" />
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`${width} ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:static z-50 h-full w-[230px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col transition-[transform,width] duration-200 ease-in-out print:hidden`}
      >
        {/* Brand + collapse toggle */}
        <div className="px-3 h-14 flex items-center gap-2.5 border-b border-[var(--color-border)]">
          <div className="w-7 h-7 shrink-0 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[#2f7a12] grid place-items-center text-[var(--color-on-accent)] font-bold text-sm shadow-lg shadow-black/40">
            E
          </div>
          {!collapsed && (
            <div className="leading-tight min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-tight truncate">
                {me?.org?.name || "EAS Intelligence"}
              </div>
              <div className="text-[10px] text-[var(--color-faint)] uppercase tracking-wider truncate">
                Maintenance Intelligence
              </div>
            </div>
          )}
          <button
            onClick={toggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="hidden md:grid place-items-center w-6 h-6 rounded-md text-[var(--color-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            <ChevronIcon className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        <nav aria-label="Primary" className="p-2.5 flex flex-col overflow-y-auto">
          {navGroups.map((group, gi) => {
            // Icon-only sidebar can't collapse groups (no headers) — show all.
            const isCollapsible = Boolean(group.collapsible) && !collapsed;
            const open = !isCollapsible || (advancedOpen ?? true);
            return (
              <div
                key={group.title}
                className={gi > 0 ? "mt-2 pt-2 border-t border-[var(--color-border-soft)]" : ""}
              >
                {!collapsed &&
                  (isCollapsible ? (
                    <button
                      onClick={toggleAdvanced}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between px-3 pt-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)] hover:text-[var(--color-muted)] select-none"
                    >
                      <span>{group.title}</span>
                      <ChevronIcon className={`w-3 h-3 transition-transform ${open ? "-rotate-90" : "rotate-180"}`} />
                    </button>
                  ) : (
                    <GroupHeader>{group.title}</GroupHeader>
                  ))}
                {open && (
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => (
                      <NavLink key={item.href} item={item} path={path} collapsed={collapsed} muted={group.muted} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {isManagerPlus && (
            <div className="mt-2 pt-2 border-t border-[var(--color-border-soft)]">
              {!collapsed && <GroupHeader>{isAdmin ? "Admin" : "Team"}</GroupHeader>}
              <div className="flex flex-col gap-0.5">
                <NavLink item={{ href: "/impact", label: "Reuse Impact", icon: AwardIcon }} path={path} collapsed={collapsed} muted />
                <NavLink item={{ href: "/reliability", label: "Reliability Report", icon: DocumentIcon }} path={path} collapsed={collapsed} muted />
                <NavLink item={{ href: "/audit", label: "Audit Trail", icon: HistoryIcon }} path={path} collapsed={collapsed} muted />
                {isAdmin && <NavLink item={{ href: "/roi", label: "Pilot Value", icon: TrophyIcon }} path={path} collapsed={collapsed} muted />}
                {isAdmin && <NavLink item={{ href: "/team", label: "Team & Roles", icon: ShieldIcon }} path={path} collapsed={collapsed} muted />}
                {isAdmin && <NavLink item={{ href: "/billing", label: "Billing", icon: CreditCardIcon }} path={path} collapsed={collapsed} muted />}
              </div>
            </div>
          )}
        </nav>

        <div className="mt-auto p-3 border-t border-[var(--color-border)]">
          {me?.user ? (
            <div className={`flex items-center gap-2.5 ${collapsed ? "md:justify-center" : ""}`}>
              <div className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] grid place-items-center text-[12px] font-semibold text-[var(--color-accent)] shrink-0">
                {me.user.name.slice(0, 1).toUpperCase()}
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate">{me.user.name}</div>
                    <div className="text-[10px] text-[var(--color-faint)] capitalize">
                      {me.user.role}
                      {!me.authRequired &&
                        (me.workspaceMode === "production"
                          ? ` · ${me.org?.name ?? "Production Workspace"}`
                          : " · demo workspace")}
                    </div>
                  </div>
                  {me.authRequired && (
                    <button
                      title="Sign out"
                      aria-label="Sign out"
                      onClick={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        window.location.href = "/login";
                      }}
                      className="text-[var(--color-faint)] hover:text-[var(--color-red)]"
                    >
                      <LogoutIcon className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            !collapsed && (
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3 text-[11px] text-[var(--color-muted)] leading-relaxed">
                <div className="font-semibold text-[var(--color-text)] mb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
                  Maintenance OS
                </div>
                Upload manuals, drawings & PLC exports to ground every answer.
              </div>
            )
          )}
        </div>
      </aside>
    </>
  );
}

// Quiet section label — small, muted, uppercase. Groups the nav so a long route
// list reads as a few calm sections instead of one crowded pile.
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-faint)] select-none">
      {children}
    </div>
  );
}

function NavLink({
  item,
  path,
  collapsed,
  muted = false,
}: {
  item: { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode };
  path: string;
  collapsed: boolean;
  muted?: boolean;
}) {
  const active = path.startsWith(item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 ${muted ? "py-1.5" : "py-2"} text-[13px] transition-colors ${
        collapsed ? "md:justify-center md:px-0" : ""
      } ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
          : `${muted ? "text-[var(--color-faint)]" : "text-[var(--color-muted)]"} hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]`
      }`}
    >
      <Icon
        className={`w-4 h-4 shrink-0 ${
          active
            ? "text-[var(--color-accent)]"
            : "text-[var(--color-faint)] group-hover:text-[var(--color-muted)]"
        }`}
      />
      {!collapsed && <span className={`${muted ? "" : "font-medium"} truncate`}>{item.label}</span>}
    </Link>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  );
}
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}
function CubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7.5 12 2 3 7.5v9L12 22l9-5.5v-9z" />
      <path d="M3 7.5 12 13l9-5.5M12 22v-9" />
    </svg>
  );
}
function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-2.3 2.5-2.5z" />
    </svg>
  );
}
function ChipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}
function PulseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" />
    </svg>
  );
}
function BoltIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}
function HelpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12" y2="17" />
    </svg>
  );
}

function BoardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-8 4 4 4-8" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6" />
    </svg>
  );
}
function AwardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M8.2 13.9 7 22l5-3 5 3-1.2-8.1" />
    </svg>
  );
}
function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 0 12 0V3H6v6z" />
      <path d="M6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M9 21h6M12 15v6" />
    </svg>
  );
}
function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
