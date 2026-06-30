import { getConnector, type ConnectorDef } from "./registry";
import { maintainxAdapter } from "./connectors/maintainx";

// Uniform adapter contract every connector implements. Live adapters call the
// vendor API; the default sandbox adapter returns deterministic mock data so the
// product demonstrates the full round-trip (connect → sync → records created)
// before any credentials exist.

export interface ExternalAsset {
  externalId: string;
  name: string;
  manufacturer?: string;
  model?: string;
  area?: string;
}

export interface ExternalWorkOrder {
  externalId: string;
  title: string;
  status: string;
  priority?: string;
  assetExternalId?: string;
}

export interface PushWorkOrderInput {
  title: string;
  description?: string;
  priority: string;
  assetName?: string;
}

export interface PushResult {
  externalId: string;
  externalSystem: string;
  url?: string;
}

export interface ConnectorAdapter {
  def: ConnectorDef;
  testConnection(): Promise<{ ok: boolean; detail: string }>;
  pullAssets?(): Promise<ExternalAsset[]>;
  pullWorkOrders?(): Promise<ExternalWorkOrder[]>;
  pushWorkOrder?(input: PushWorkOrderInput): Promise<PushResult>;
}

// Deterministic sandbox adapter — used until live credentials are wired in.
function sandboxAdapter(def: ConnectorDef): ConnectorAdapter {
  const seedAssets: ExternalAsset[] = [
    { externalId: `${def.key}-A100`, name: `${def.name} Line 1 Filler`, manufacturer: "Krones", model: "Modulfill", area: "Filling" },
    { externalId: `${def.key}-A101`, name: `${def.name} Case Packer`, manufacturer: "Allen-Bradley", model: "PowerFlex 525", area: "Packaging" },
    { externalId: `${def.key}-A102`, name: `${def.name} Ammonia Compressor`, manufacturer: "Frick", model: "RWB II", area: "Refrigeration" },
  ];
  const seedWOs: ExternalWorkOrder[] = [
    { externalId: `${def.key}-WO5001`, title: "Filler servo fault — investigate", status: "open", priority: "high", assetExternalId: `${def.key}-A100` },
    { externalId: `${def.key}-WO5002`, title: "Monthly PM — case packer", status: "open", priority: "medium", assetExternalId: `${def.key}-A101` },
  ];

  return {
    def,
    async testConnection() {
      return {
        ok: true,
        detail: `Sandbox connection to ${def.name} OK. Add live ${def.auth} credentials to go to production.`,
      };
    },
    async pullAssets() {
      return def.capabilities.includes("pull_assets") ? seedAssets : [];
    },
    async pullWorkOrders() {
      return def.capabilities.includes("pull_work_orders") ? seedWOs : [];
    },
    async pushWorkOrder(input) {
      const externalId = `${def.key}-WO${Math.floor(10000 + Math.random() * 89999)}`;
      return {
        externalId,
        externalSystem: def.name,
        url: `https://sandbox.${def.key}.example/wo/${externalId}`,
      };
    },
  };
}

// Live-credential lookup by env convention: <CONNECTOR>_API_KEY (e.g.
// MAINTAINX_API_KEY). Secrets live in env/vault, never in the DB.
export function liveCredential(connectorKey: string): string | undefined {
  const envName = `${connectorKey.toUpperCase()}_API_KEY`;
  return process.env[envName] || undefined;
}

export function isLiveConnector(connectorKey: string): boolean {
  return Boolean(liveCredential(connectorKey));
}

// Registered live adapter factories. Add new ones here as they're implemented.
const LIVE_ADAPTERS: Record<
  string,
  (def: ConnectorDef, apiKey: string) => ConnectorAdapter
> = {
  maintainx: maintainxAdapter,
};

// Resolve an adapter for a connector: a real adapter when live credentials are
// present, otherwise the deterministic sandbox adapter.
export function getAdapter(connectorKey: string): ConnectorAdapter | null {
  const def = getConnector(connectorKey);
  if (!def) return null;
  const cred = liveCredential(connectorKey);
  const factory = LIVE_ADAPTERS[connectorKey];
  if (cred && factory) return factory(def, cred);
  return sandboxAdapter(def);
}
