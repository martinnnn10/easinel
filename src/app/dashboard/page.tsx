"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface KpiData {
  mttrHours: number | null;
  mtbfDays: number | null;
  openWorkOrders: { total: number; urgent: number; high: number; medium: number; low: number };
  pmCompliance: number | null;
  downtimeHours: number;
  downtimeCostPerHour: number | null;
  downtimeCost: number | null;
  prevDowntimeHours: number;
  downtimeDeltaPct: number | null;
  assetHealth: { total: number; operational: number; degraded: number; down: number };
  workOrderTrend: { period: string; count: number }[];
  downtimeTrend: { period: string; hours: number }[];
}

// Calm graphite-palette chart colors — desaturated to match the theme tokens
// (see globals.css). Concrete hexes rather than CSS vars so Recharts SVG fills
// resolve reliably across renderers.
const COLORS = {
  accent: "#5f9748",
  accentLight: "#6ea457",
  urgent: "#e05252",
  high: "#d6a23a",
  medium: "#5f9748",
  low: "#7f8b7b",
  operational: "#57b06a",
  degraded: "#d6a23a",
  down: "#e05252",
};

function KpiCard({
  title,
  value,
  unit,
  subtitle,
  color,
}: {
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium mb-1">
        {title}
      </p>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[28px] font-bold"
          style={{ color: color || "var(--color-text)" }}
        >
          {value}
        </span>
        {unit && <span className="text-[12px] text-[var(--color-muted)]">{unit}</span>}
      </div>
      {subtitle && (
        <p className="text-[11px] text-[var(--color-muted)] mt-1">{subtitle}</p>
      )}
    </div>
  );
}

function periodLabel(days: number): string {
  if (days <= 30) return "last 30 days";
  if (days <= 90) return "this quarter";
  if (days <= 180) return "last 6 months";
  return "last year";
}

// The ROI headline. Downtime this period in hours, dollarized once the org sets a
// fully-loaded rate, with a signed period-over-period verdict. Honest: shows
// hours-only (and a calm prompt) until a real rate exists — never invents a rate.
function ValueBand({
  data,
  periodDays,
  canEdit,
  onSaved,
}: {
  data: KpiData;
  periodDays: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState(data.downtimeCostPerHour != null ? String(data.downtimeCostPerHour) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const val = rate.trim() === "" ? null : Number(rate);
      await fetch("/api/org", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ downtimeCostPerHour: val }),
      });
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const delta = data.downtimeDeltaPct;
  // Less downtime than the prior period is good (green ↓); more is bad (red ↑).
  const deltaColor = delta == null || delta === 0 ? "var(--color-muted)" : delta < 0 ? "var(--color-green)" : "var(--color-red)";
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Downtime impact · {periodLabel(periodDays)}
          </p>
          <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
            {data.downtimeCost != null ? (
              <>
                <span className="text-[30px] font-semibold tracking-tight text-[var(--color-red)]">{money(data.downtimeCost)}</span>
                <span className="text-[14px] text-[var(--color-muted)]">{data.downtimeHours} h of downtime</span>
              </>
            ) : (
              <span className="text-[30px] font-semibold tracking-tight">{data.downtimeHours} <span className="text-[16px] font-normal text-[var(--color-muted)]">h of downtime</span></span>
            )}
            {delta != null && (
              <span className="text-[13px] font-medium" style={{ color: deltaColor }}>
                {delta < 0 ? "↓" : delta > 0 ? "↑" : ""} {Math.abs(delta)}% vs prior {periodLabel(periodDays).replace("this ", "").replace("last ", "")}
              </span>
            )}
          </div>
        </div>

        {/* Rate control */}
        <div className="shrink-0">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-[var(--color-muted)]">$</span>
              <input
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="0"
                autoFocus
                className="w-24 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-[12px] text-[var(--color-muted)]">/hr</span>
              <button onClick={save} disabled={busy} className="text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] px-3 py-1.5 hover:brightness-110 disabled:opacity-50">
                {busy ? "…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)] px-1">Cancel</button>
            </div>
          ) : data.downtimeCostPerHour != null ? (
            <div className="text-[12px] text-[var(--color-faint)]">
              at ${data.downtimeCostPerHour.toLocaleString()}/h
              {canEdit && (
                <button onClick={() => setEditing(true)} className="ml-2 text-[var(--color-accent)] hover:underline">edit</button>
              )}
            </div>
          ) : canEdit ? (
            <button
              onClick={() => setEditing(true)}
              className="text-[12px] font-medium rounded-lg border border-[var(--color-accent)] text-[var(--color-accent)] px-3 py-1.5 hover:bg-[var(--color-accent)]/10"
            >
              Set downtime rate → see $ impact
            </button>
          ) : (
            <p className="text-[11.5px] text-[var(--color-faint)] max-w-[180px]">
              Ask an admin to set your line&apos;s downtime rate to see dollar impact.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(90);
  const [role, setRole] = useState<string>("");

  const loadData = () =>
    fetch(`/api/dashboard?days=${period}`)
      .then((r) => r.json())
      .then(setData);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setRole(d?.user?.role ?? "")).catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-[20px] font-semibold mb-6">Dashboard</h1>
          <p className="text-[13px] text-[var(--color-muted)]">Loading KPIs…</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-[20px] font-semibold mb-6">Dashboard</h1>
          <p className="text-[13px] text-[var(--color-muted)]">Failed to load dashboard data.</p>
        </div>
      </div>
    );
  }

  const assetPieData = [
    { name: "Operational", value: data.assetHealth.operational, color: COLORS.operational },
    { name: "Degraded", value: data.assetHealth.degraded, color: COLORS.degraded },
    { name: "Down", value: data.assetHealth.down, color: COLORS.down },
  ].filter((d) => d.value > 0);

  const woPriorityData = [
    { name: "Urgent", value: data.openWorkOrders.urgent, color: COLORS.urgent },
    { name: "High", value: data.openWorkOrders.high, color: COLORS.high },
    { name: "Medium", value: data.openWorkOrders.medium, color: COLORS.medium },
    { name: "Low", value: data.openWorkOrders.low, color: COLORS.low },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[20px] font-semibold">Dashboard</h1>
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
        </div>

        {/* Value band — the ROI headline: downtime this period, in hours and (once
            a rate is set) dollars, with a period-over-period verdict. */}
        <ValueBand
          data={data}
          periodDays={period}
          canEdit={role === "owner" || role === "admin"}
          onSaved={loadData}
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <KpiCard
            title="MTTR"
            value={data.mttrHours !== null ? data.mttrHours : "—"}
            unit="hours"
            subtitle="Mean Time To Repair"
            color={data.mttrHours !== null && data.mttrHours > 24 ? COLORS.urgent : COLORS.accent}
          />
          <KpiCard
            title="MTBF"
            value={data.mtbfDays !== null ? data.mtbfDays : "—"}
            unit="days"
            subtitle="Mean Time Between Failures"
            color={data.mtbfDays !== null && data.mtbfDays < 7 ? COLORS.urgent : COLORS.accent}
          />
          <KpiCard
            title="Open WOs"
            value={data.openWorkOrders.total}
            subtitle={data.openWorkOrders.urgent > 0 ? `${data.openWorkOrders.urgent} urgent` : undefined}
            color={data.openWorkOrders.urgent > 0 ? COLORS.urgent : undefined}
          />
          <KpiCard
            title="PM Compliance"
            value={data.pmCompliance !== null ? `${data.pmCompliance}` : "—"}
            unit="%"
            subtitle="Scheduled PMs completed"
            color={
              data.pmCompliance !== null
                ? data.pmCompliance >= 80
                  ? COLORS.accent
                  : data.pmCompliance >= 50
                  ? COLORS.medium
                  : COLORS.urgent
                : undefined
            }
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <KpiCard
            title="Downtime"
            value={data.downtimeHours}
            unit="hours"
            subtitle={`Last ${period} days`}
          />
          <KpiCard
            title="Assets"
            value={data.assetHealth.total}
            subtitle={`${data.assetHealth.operational} operational`}
            color={COLORS.accent}
          />
          <KpiCard
            title="Assets Down"
            value={data.assetHealth.down}
            color={data.assetHealth.down > 0 ? COLORS.urgent : COLORS.accent}
          />
          <KpiCard
            title="Degraded"
            value={data.assetHealth.degraded}
            color={data.assetHealth.degraded > 0 ? COLORS.medium : COLORS.accent}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Work Order Trend */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[13px] font-semibold mb-4">Work Order Volume (12 weeks)</h2>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.workOrderTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                  />
                  <Bar dataKey="count" fill={COLORS.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Downtime Trend */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[13px] font-semibold mb-4">Downtime Hours (12 weeks)</h2>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.downtimeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    stroke={COLORS.urgent}
                    strokeWidth={2}
                    dot={{ r: 3, fill: COLORS.urgent }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Asset Health Pie */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[13px] font-semibold mb-4">Asset Health</h2>
            <div className="h-[200px] flex items-center justify-center">
              {assetPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={assetPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {assetPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[12px] text-[var(--color-muted)]">No asset data yet</p>
              )}
            </div>
          </div>

          {/* Open WOs by Priority */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-[13px] font-semibold mb-4">Open Work Orders by Priority</h2>
            <div className="h-[200px] flex items-center justify-center">
              {woPriorityData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={woPriorityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {woPriorityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[12px] text-[var(--color-muted)]">No open work orders</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
