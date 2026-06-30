"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  ssoProvider?: string | null;
  lastLoginAt?: number | null;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  expiresAt: number;
}

const ROLES = ["owner", "admin", "manager", "technician", "viewer"];
const INVITE_ROLES = ["admin", "manager", "technician", "viewer"];
const ROLE_DESC: Record<string, string> = {
  owner: "Full control incl. billing & owners",
  admin: "Manage users, integrations, API keys",
  manager: "Workforce, work orders, all maintenance",
  technician: "Create/update work orders, ask Copilot, upload",
  viewer: "Read-only + ask Copilot",
};

export default function TeamPage() {
  const [orgName, setOrgName] = useState("");
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [you, setYou] = useState<{ id: string; role: string } | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/org");
    if (res.status === 403 || res.status === 401) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const d = await res.json();
    setOrgName(d.org?.name ?? "");
    setOrgNameDraft(d.org?.name ?? "");
    setMembers(d.members ?? []);
    setInvites(d.invitations ?? []);
    setYou(d.you ?? null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const canManage = you?.role === "owner" || you?.role === "admin";

  const saveOrgName = async () => {
    if (!orgNameDraft.trim() || orgNameDraft === orgName) return;
    await fetch("/api/org", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: orgNameDraft }),
    });
    setOrgName(orgNameDraft);
  };

  return (
    <>
      <TopBar
        title="Organization"
        subtitle="Members · roles · invitations · enterprise SSO"
        right={
          canManage && (
            <button
              onClick={() => setShowInvite(true)}
              className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110"
            >
              + Invite member
            </button>
          )
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-6">
          {loading ? (
            <p className="text-[var(--color-muted)] text-sm">Loading…</p>
          ) : forbidden ? (
            <div className="text-center py-20">
              <p className="text-[15px] font-medium">Sign in required</p>
              <p className="text-[var(--color-muted)] text-sm mt-1">
                Please sign in to view your organization.
              </p>
            </div>
          ) : (
            <>
              {/* Organization settings */}
              <section className="mb-7">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                  Organization
                </h2>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-end gap-3">
                  <label className="flex-1 block">
                    <span className="text-[11px] text-[var(--color-muted)] uppercase tracking-wide">Name</span>
                    <input
                      value={orgNameDraft}
                      disabled={!canManage}
                      onChange={(e) => setOrgNameDraft(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)] disabled:opacity-60"
                    />
                  </label>
                  {canManage && (
                    <button
                      onClick={saveOrgName}
                      disabled={!orgNameDraft.trim() || orgNameDraft === orgName}
                      className="text-[13px] font-medium rounded-lg border border-[var(--color-border)] px-3.5 py-2 hover:border-[var(--color-accent)]/60 disabled:opacity-40"
                    >
                      Save
                    </button>
                  )}
                </div>
              </section>

              {/* Role legend */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-6">
                {ROLES.map((r) => (
                  <div key={r} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <div className="text-[12px] font-semibold capitalize">{r}</div>
                    <div className="text-[10px] text-[var(--color-muted)] mt-1 leading-snug">{ROLE_DESC[r]}</div>
                  </div>
                ))}
              </div>

              {/* Members */}
              <section className="mb-7">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                  Members ({members.length})
                </h2>
                <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                  {members.map((u, i) => (
                    <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
                      <div className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] grid place-items-center text-[12px] font-semibold text-[var(--color-accent)]">
                        {u.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">
                          {u.name}
                          {u.ssoProvider && (
                            <span className="ml-2 text-[10px] uppercase text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded-full">SSO</span>
                          )}
                          {you?.id === u.id && (
                            <span className="ml-2 text-[10px] text-[var(--color-faint)]">you</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--color-faint)] truncate">{u.email}</div>
                      </div>
                      {canManage && you?.id !== u.id ? (
                        <>
                          <select
                            value={u.role}
                            onChange={async (e) => {
                              await fetch(`/api/org/members/${u.id}`, {
                                method: "PATCH",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ role: e.target.value }),
                              });
                              load();
                            }}
                            className="text-[12px] rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-1 outline-none capitalize"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                          <button
                            onClick={async () => {
                              if (!confirm(`Remove ${u.name} from the organization?`)) return;
                              await fetch(`/api/org/members/${u.id}`, { method: "DELETE" });
                              load();
                            }}
                            className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-red)] px-1"
                            title="Remove member"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <span className="text-[12px] text-[var(--color-muted)] capitalize px-2">{u.role}</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Pending invitations */}
              {canManage && invites.length > 0 && (
                <section>
                  <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)] mb-2">
                    Pending invitations ({invites.length})
                  </h2>
                  <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                    {invites.map((inv, i) => (
                      <div key={inv.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate">{inv.email}</div>
                          <div className="text-[11px] text-[var(--color-faint)]">
                            <span className="capitalize">{inv.role}</span> · expires {new Date(inv.expiresAt).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            await fetch(`/api/org/invitations?id=${inv.id}`, { method: "DELETE" });
                            load();
                          }}
                          className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-red)]"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onSaved={() => { setShowInvite(false); load(); }} />
      )}
    </>
  );
}

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ email: "", role: "technician" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [acceptUrl, setAcceptUrl] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 fadeup" onClick={(e) => e.stopPropagation()}>
        {acceptUrl ? (
          <>
            <h2 className="font-semibold text-[15px] mb-2">Invitation created</h2>
            <p className="text-[12px] text-[var(--color-muted)] mb-3">
              Share this secure link with your teammate. It expires in 14 days and can be used once.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={acceptUrl}
                className="flex-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[12px] outline-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(acceptUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 hover:brightness-110"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={onSaved} className="text-[13px] font-medium px-4 py-1.5 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)]/60">
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-semibold text-[15px] mb-4">Invite member</h2>
            <div className="space-y-3">
              <input
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none capitalize"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {err && <p className="text-[12px] text-[var(--color-red)] mt-2">{err}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} className="text-[13px] px-3 py-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)]">Cancel</button>
              <button
                disabled={busy || !form.email.includes("@")}
                onClick={async () => {
                  setBusy(true); setErr("");
                  const res = await fetch("/api/org/invitations", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(form),
                  });
                  const d = await res.json();
                  if (!res.ok) { setErr(d.message || d.error || "Failed"); setBusy(false); return; }
                  setAcceptUrl(d.acceptUrl);
                  setBusy(false);
                }}
                className="text-[13px] font-medium px-4 py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40 hover:brightness-110"
              >
                {busy ? "Inviting…" : "Send invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
