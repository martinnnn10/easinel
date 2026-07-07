"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";

interface Connector {
  key: string;
  name: string;
  category: string;
  blurb: string;
  auth: string;
  capabilities: string[];
  popular?: boolean;
  live?: boolean;
}
interface Connected {
  connectorKey: string;
  status: string;
  lastSyncAt?: number | null;
}

const CAT_LABEL: Record<string, string> = {
  cmms: "CMMS / EAM",
  erp: "ERP",
  sensors: "Sensors & Condition Monitoring",
};
const CAT_ORDER = ["cmms", "erp", "sensors"];

export default function IntegrationsPage() {
  const [tab, setTab] = useState<"connectors" | "developers">("connectors");
  return (
    <>
      <TopBar
        title="Integrations"
        subtitle="EAS sits on top of your maintenance stack — CMMS/EAM, ERP & condition-monitoring sensors"
        right={
          <div className="flex gap-1 bg-[var(--color-surface-2)] rounded-lg p-0.5">
            {(["connectors", "developers"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-[12px] px-3 py-1 rounded-md capitalize transition ${
                  tab === t
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {t === "developers" ? "API & Webhooks" : "Connectors"}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-6">
          {tab === "connectors" ? <Connectors /> : <Developers />}
        </div>
      </div>
    </>
  );
}

function Connectors() {
  const [catalog, setCatalog] = useState<Connector[]>([]);
  const [connected, setConnected] = useState<Connected[]>([]);
  const [busy, setBusy] = useState<string>("");

  const load = useCallback(async () => {
    const d = await fetch("/api/integrations").then((r) => r.json());
    setCatalog(d.catalog ?? []);
    setConnected(d.connected ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const statusOf = (key: string) =>
    connected.find((c) => c.connectorKey === key)?.status ?? "disconnected";

  const [note, setNote] = useState<{ kind: "ok" | "info"; text: string } | null>(null);

  const act = async (connectorKey: string, action: string) => {
    setBusy(connectorKey + action);
    const d = await fetch("/api/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, connectorKey }),
    }).then((r) => r.json());
    if (action === "sync") {
      if (d.imported) {
        const bits = [
          `${d.assetsImported} assets`,
          `${d.workOrdersImported} work orders`,
          d.workOrdersUpdated ? `${d.workOrdersUpdated} updated` : null,
        ].filter(Boolean).join(" · ");
        setNote({ kind: "ok", text: `Synced from live ${connectorKey}: ${bits}.` });
      } else {
        // Honest: sandbox/preview never writes sample data into the workspace.
        setNote({ kind: "info", text: d.reason ?? "Preview connector — no data imported." });
      }
      setTimeout(() => setNote(null), 7000);
    }
    setBusy("");
    load();
  };

  return (
    <>
      {note && (
        <div className={`mb-4 rounded-lg text-[13px] px-3 py-2 border ${
          note.kind === "ok"
            ? "bg-[var(--color-green)]/10 border-[var(--color-green)]/30 text-[var(--color-green)]"
            : "bg-[var(--color-amber)]/10 border-[var(--color-amber)]/30 text-[var(--color-amber)]"
        }`}>
          {note.text}
        </div>
      )}
      <div className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 py-3 mb-6 text-[12px] text-[var(--color-muted)]">
        Each connector activates the moment you add live credentials. Until then
        it stays in a safe <strong className="text-[var(--color-text)]">preview state</strong> so you
        can review the data contract and field mapping first. A preview connector
        never writes sample data into your workspace — a real sync imports your
        equipment and work orders only once your own credentials are live.
      </div>

      {CAT_ORDER.map((cat) => {
        const items = catalog.filter((c) => c.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="mb-8">
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] mb-3">
              {CAT_LABEL[cat]}
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((c) => {
                const status = statusOf(c.key);
                const isConnected = status === "connected";
                return (
                  <div
                    key={c.key}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col"
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-9 h-9 rounded-lg bg-[var(--color-surface-2)] grid place-items-center text-[13px] font-bold text-[var(--color-accent)]">
                        {c.name.slice(0, 2)}
                      </div>
                      {c.live ? (
                        <span className="text-[9px] uppercase tracking-wide text-[var(--color-green)] bg-[var(--color-green)]/10 px-1.5 py-0.5 rounded-full">
                          Live
                        </span>
                      ) : c.popular ? (
                        <span className="text-[9px] uppercase tracking-wide text-[var(--color-amber)] bg-[var(--color-amber)]/10 px-1.5 py-0.5 rounded-full">
                          Popular
                        </span>
                      ) : null}
                    </div>
                    <h4 className="font-semibold text-[14px] mt-2.5 flex items-center gap-1.5">
                      {c.name}
                      {isConnected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" />
                      )}
                    </h4>
                    <p className="text-[12px] text-[var(--color-muted)] mt-1 flex-1">
                      {c.blurb}
                    </p>
                    <div className="flex gap-1.5 mt-3">
                      {!isConnected ? (
                        <button
                          disabled={busy === c.key + "connect"}
                          onClick={() => act(c.key, "connect")}
                          className="flex-1 text-[12px] font-medium rounded-lg bg-[var(--color-accent)] text-white py-1.5 hover:brightness-110 disabled:opacity-50"
                        >
                          {busy === c.key + "connect" ? "Connecting…" : "Connect"}
                        </button>
                      ) : (
                        <>
                          <button
                            disabled={busy === c.key + "sync"}
                            onClick={() => act(c.key, "sync")}
                            className="flex-1 text-[12px] font-medium rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] py-1.5 hover:border-[var(--color-accent)]/50 disabled:opacity-50"
                          >
                            {busy === c.key + "sync" ? "Syncing…" : "Sync now"}
                          </button>
                          <button
                            onClick={() => act(c.key, "disconnect")}
                            className="text-[12px] rounded-lg px-2.5 py-1.5 text-[var(--color-faint)] hover:text-[var(--color-red)]"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Developers() {
  return (
    <div className="space-y-8">
      <ApiKeys />
      <Webhooks />
      <ApiDocs />
    </div>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string }[]>([]);
  const [fresh, setFresh] = useState<string>("");
  const load = () => fetch("/api/keys").then((r) => r.json()).then((d) => setKeys(d.keys ?? []));
  useEffect(() => {
    load();
  }, []);
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-[14px]">API Keys</h3>
          <p className="text-[12px] text-[var(--color-muted)]">
            Authenticate the public platform API: <code className="text-[var(--color-accent)]">Authorization: Bearer eas_live_…</code>
          </p>
        </div>
        <button
          onClick={async () => {
            const d = await fetch("/api/keys", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "API key" }),
            }).then((r) => r.json());
            setFresh(d.key?.plaintext ?? "");
            load();
          }}
          className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 hover:brightness-110"
        >
          + Create key
        </button>
      </div>
      {fresh && (
        <div className="mb-3 rounded-lg bg-[var(--color-amber)]/10 border border-[var(--color-amber)]/30 p-3">
          <p className="text-[11px] text-[var(--color-amber)] mb-1">
            Copy this now — it won't be shown again.
          </p>
          <code className="text-[12px] break-all text-[var(--color-text)] font-mono">{fresh}</code>
        </div>
      )}
      <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
        {keys.length === 0 ? (
          <p className="text-[13px] text-[var(--color-faint)] px-4 py-4">No keys yet.</p>
        ) : (
          keys.map((k, i) => (
            <div key={k.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
              <span className="text-[13px] font-medium flex-1">{k.name}</span>
              <code className="text-[12px] text-[var(--color-muted)] font-mono">{k.prefix}••••</code>
              <button
                onClick={async () => {
                  await fetch(`/api/keys?id=${k.id}`, { method: "DELETE" });
                  load();
                }}
                className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-red)]"
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Webhooks() {
  const [hooks, setHooks] = useState<{ id: string; url: string; events: string }[]>([]);
  const [url, setUrl] = useState("");
  const load = () => fetch("/api/webhooks").then((r) => r.json()).then((d) => setHooks(d.webhooks ?? []));
  useEffect(() => {
    load();
  }, []);
  return (
    <section>
      <h3 className="font-semibold text-[14px] mb-1">Webhooks</h3>
      <p className="text-[12px] text-[var(--color-muted)] mb-3">
        Get notified on <code className="text-[var(--color-accent)]">workorder.created</code>,{" "}
        <code className="text-[var(--color-accent)]">integration.synced</code>,{" "}
        <code className="text-[var(--color-accent)]">copilot.answered</code> and more. Payloads are HMAC-signed.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-system.example/webhooks/eas"
          className="flex-1 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          disabled={!/^https?:\/\//.test(url)}
          onClick={async () => {
            await fetch("/api/webhooks", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ url, events: "*" }),
            });
            setUrl("");
            load();
          }}
          className="text-[13px] font-medium rounded-lg bg-[var(--color-accent)] text-white px-3.5 py-1.5 disabled:opacity-40 hover:brightness-110"
        >
          Add
        </button>
      </div>
      <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
        {hooks.length === 0 ? (
          <p className="text-[13px] text-[var(--color-faint)] px-4 py-4">No webhooks yet.</p>
        ) : (
          hooks.map((h, i) => (
            <div key={h.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[var(--color-border-soft)]" : ""}`}>
              <span className="text-[13px] font-mono truncate flex-1">{h.url}</span>
              <span className="text-[11px] text-[var(--color-muted)]">{h.events}</span>
              <button
                onClick={async () => {
                  await fetch(`/api/webhooks?id=${h.id}`, { method: "DELETE" });
                  load();
                }}
                className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-red)]"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ApiDocs() {
  return (
    <section>
      <h3 className="font-semibold text-[14px] mb-2">Quickstart</h3>
      <pre className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-[12px] overflow-x-auto font-mono text-[var(--color-text)]">{`# Ask the Copilot from anywhere
curl -X POST $HOST/api/v1/ask \\
  -H "Authorization: Bearer eas_live_..." \\
  -H "content-type: application/json" \\
  -d '{"question":"PowerFlex 525 fault F081, what first?"}'

# Create a work order
curl -X POST $HOST/api/v1/work-orders \\
  -H "Authorization: Bearer eas_live_..." \\
  -d '{"title":"Replace conveyor gearbox","priority":"high"}'`}</pre>
    </section>
  );
}
