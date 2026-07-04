"use client";

import { useEffect, useState } from "react";

interface Data {
  provider: { configured: boolean; name: string; model: string | null; mode: string; lastProviderError: string | null; lastSuccessAt: number | null; killSwitch: boolean };
  plan: { key: string; name: string; priceLabel: string };
  quota: { aiQuestionsPerMonth: number | null; used: number; remaining: number | null; overQuota: boolean };
  usage: { questions: number; liveQuestions: number; promptTokens: number; completionTokens: number; costUsd: number; byModel: { model: string; questions: number; tokens: number; costUsd: number }[] };
}

// Admin-facing "is the Copilot on live Claude or fallback?" panel + monthly AI
// usage / cost / quota. Rendered on Team & Roles for owners/admins.
export function AiStatusPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/api/admin/ai-usage").then((r) => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setErr(true));
  }, []);
  if (err) return null;
  if (!d) return <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 h-40 animate-pulse" />;

  const live = d.provider.mode === "live";
  const capPct = d.quota.aiQuestionsPerMonth ? Math.min(100, Math.round((d.quota.used / d.quota.aiQuestionsPerMonth) * 100)) : 0;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">AI Provider Status</h3>
        <span className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
          live ? "border-[var(--color-green)]/40 text-[var(--color-green)] bg-[var(--color-green)]/5"
               : "border-[var(--color-amber)]/40 text-[var(--color-amber)] bg-[var(--color-amber)]/5"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-[var(--color-green)]" : "bg-[var(--color-amber)]"}`} />
          {live ? "Live" : "Fallback"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
        <Row k="Provider" v={providerLabel(d.provider.name)} />
        <Row k="Model" v={d.provider.model ?? "— (deterministic)"} />
        <Row k="Mode" v={live ? "Live LLM" : "Deterministic fallback"} />
        <Row k="Last success" v={d.provider.lastSuccessAt ? new Date(d.provider.lastSuccessAt).toLocaleString() : "—"} />
        <Row k="Plan" v={`${d.plan.name}`} />
        <Row k="Kill switch" v={d.provider.killSwitch ? "ON (forcing fallback)" : "off"} tone={d.provider.killSwitch ? "amber" : undefined} />
      </dl>

      {!d.provider.configured && (
        <p className="mt-2 text-[11.5px] text-[var(--color-amber)]">No live AI key set — set <code className="font-mono">ANTHROPIC_API_KEY</code> on the server (see AI_PROVIDER_SETUP.md).</p>
      )}
      {d.provider.lastProviderError && (
        <p className="mt-2 text-[11.5px] text-[var(--color-red)] break-words">Last provider error: {d.provider.lastProviderError.slice(0, 160)}</p>
      )}

      {/* Monthly quota */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11.5px] mb-1">
          <span className="text-[var(--color-muted)]">AI questions this month</span>
          <span className={d.quota.overQuota ? "text-[var(--color-red)] font-medium" : "text-[var(--color-text)]"}>
            {d.quota.used}{d.quota.aiQuestionsPerMonth != null ? ` / ${d.quota.aiQuestionsPerMonth}` : " (unlimited)"}
          </span>
        </div>
        {d.quota.aiQuestionsPerMonth != null && (
          <div className="h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
            <div className="h-full" style={{ width: `${capPct}%`, background: d.quota.overQuota ? "var(--color-red)" : capPct > 80 ? "var(--color-amber)" : "var(--color-green)" }} />
          </div>
        )}
        {d.quota.overQuota && <p className="mt-1 text-[11px] text-[var(--color-red)]">Monthly limit reached — Copilot is serving deterministic answers until the month rolls over or the plan is upgraded.</p>}
      </div>

      {/* Cost + model breakdown */}
      <div className="mt-4 pt-3 border-t border-[var(--color-border-soft)]">
        <div className="flex items-center justify-between text-[12px] mb-2">
          <span className="text-[var(--color-muted)]">Est. AI cost this month</span>
          <span className="font-semibold">${d.usage.costUsd.toFixed(2)}</span>
        </div>
        {d.usage.byModel.length > 0 ? (
          <div className="space-y-1">
            {d.usage.byModel.map((m) => (
              <div key={m.model} className="flex items-center justify-between text-[11.5px] text-[var(--color-muted)]">
                <span className="font-mono">{m.model}</span>
                <span>{m.questions} q · {(m.tokens / 1000).toFixed(1)}k tok · ${m.costUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--color-faint)]">No AI questions yet this month.</p>
        )}
        <p className="mt-2 text-[10.5px] text-[var(--color-faint)]">Token counts and cost are estimates (~4 chars/token) for budgeting; fault-code lookups are answered deterministically at no LLM cost.</p>
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "amber" }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">{k}</dt>
      <dd className="text-[var(--color-text)]" style={tone === "amber" ? { color: "var(--color-amber)" } : undefined}>{v}</dd>
    </div>
  );
}

function providerLabel(name: string): string {
  if (name === "anthropic") return "Anthropic (Claude)";
  if (name === "openai-compatible") return "OpenAI-compatible";
  return "Deterministic fallback";
}
