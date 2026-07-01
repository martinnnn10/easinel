"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Asset-first navigation: maintenance departments organize work around the
// MACHINE, not around record types. Equipment leads; everything else (work
// orders, PMs, parts, knowledge, PLC) hangs off the machine you're working on.
// Future modules (Workforce, Integrations, Analytics) are built but hidden until
// functional.
const nav = [
  { href: "/assets", label: "Equipment", icon: CubeIcon },
  { href: "/", label: "Copilot", icon: SparkIcon },
  { href: "/sessions", label: "Sessions", icon: PulseIcon },
  { href: "/work-orders", label: "Work Orders", icon: WrenchIcon },
  { href: "/pm", label: "PM Program", icon: CalendarIcon },
  { href: "/parts", label: "Parts", icon: BoltIcon },
  { href: "/knowledge", label: "Knowledge", icon: BookIcon },
  { href: "/plc", label: "PLC Explorer", icon: ChipIcon },
  { href: "/help", label: "How-To", icon: HelpIcon },
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

  if (path.startsWith("/login")) return null;

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
        } md:translate-x-0 fixed md:static z-50 h-full w-[230px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col transition-[transform,width] duration-200 ease-in-out`}
      >
        {/* Brand + collapse toggle */}
        <div className="px-3 h-14 flex items-center gap-2.5 border-b border-[var(--color-border)]">
          <div className="w-7 h-7 shrink-0 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[#1456b0] grid place-items-center text-white font-bold text-sm shadow-lg shadow-blue-900/30">
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

        <nav aria-label="Primary" className="p-2.5 flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink key={item.href} item={item} path={path} collapsed={collapsed} />
          ))}
        </nav>

        {isAdmin && (
          <div className="px-2.5">
            <NavLink
              item={{ href: "/team", label: "Team & Roles", icon: ShieldIcon }}
              path={path}
              collapsed={collapsed}
            />
          </div>
        )}

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

function NavLink({
  item,
  path,
  collapsed,
}: {
  item: { href: string; label: string; icon: (p: { className?: string }) => React.ReactNode };
  path: string;
  collapsed: boolean;
}) {
  const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
        collapsed ? "md:justify-center md:px-0" : ""
      } ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-text)]"
      }`}
    >
      <Icon
        className={`w-4 h-4 shrink-0 ${
          active
            ? "text-[var(--color-accent)]"
            : "text-[var(--color-faint)] group-hover:text-[var(--color-muted)]"
        }`}
      />
      {!collapsed && <span className="font-medium truncate">{item.label}</span>}
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
