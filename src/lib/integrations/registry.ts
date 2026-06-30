// The catalog of systems EAS integrates with. This is what makes EAS a
// platform, not an app: it sits ON TOP of the customer's existing CMMS, CRM,
// ATS, ERP, and sensor stack and becomes the layer of intelligence across them.
//
// Each connector declares its category, auth model, and capabilities. Live
// credentials are supplied per-deployment (env / vault); until then a connector
// runs in sandbox mode against a deterministic mock so the whole flow is
// demoable end-to-end.

export type ConnectorCategory = "cmms" | "crm" | "ats" | "erp" | "sensors";

export type Capability =
  | "pull_assets"
  | "push_work_order"
  | "pull_work_orders"
  | "pull_people"
  | "push_candidate_match"
  | "pull_sensor_alerts"
  | "pull_failures";

export interface ConnectorDef {
  key: string;
  name: string;
  category: ConnectorCategory;
  blurb: string;
  auth: "api_key" | "oauth2" | "basic" | "token";
  capabilities: Capability[];
  docsUrl?: string;
  popular?: boolean;
}

export const CONNECTORS: ConnectorDef[] = [
  // ── CMMS / EAM ──────────────────────────────────────────────
  {
    key: "maintainx",
    name: "MaintainX",
    category: "cmms",
    blurb: "Sync work orders & assets with MaintainX.",
    auth: "api_key",
    capabilities: ["push_work_order", "pull_work_orders", "pull_assets"],
    popular: true,
  },
  {
    key: "fiix",
    name: "Fiix (Rockwell)",
    category: "cmms",
    blurb: "Two-way work order and asset sync with Fiix CMMS.",
    auth: "api_key",
    capabilities: ["push_work_order", "pull_work_orders", "pull_assets", "pull_failures"],
    popular: true,
  },
  {
    key: "limble",
    name: "Limble CMMS",
    category: "cmms",
    blurb: "Push Copilot-generated work orders & PMs to Limble.",
    auth: "api_key",
    capabilities: ["push_work_order", "pull_assets"],
  },
  {
    key: "upkeep",
    name: "UpKeep",
    category: "cmms",
    blurb: "Mobile-first CMMS work order sync.",
    auth: "api_key",
    capabilities: ["push_work_order", "pull_work_orders"],
  },
  {
    key: "sap_pm",
    name: "SAP PM",
    category: "erp",
    blurb: "Enterprise plant maintenance notifications & orders (SAP PM/EAM).",
    auth: "oauth2",
    capabilities: ["push_work_order", "pull_assets", "pull_failures"],
    popular: true,
  },
  {
    key: "maximo",
    name: "IBM Maximo",
    category: "erp",
    blurb: "Asset & work order sync with Maximo Application Suite.",
    auth: "oauth2",
    capabilities: ["push_work_order", "pull_work_orders", "pull_assets"],
  },

  // ── CRM ─────────────────────────────────────────────────────
  {
    key: "salesforce",
    name: "Salesforce",
    category: "crm",
    blurb: "Field Service / Service Cloud: cases, assets, accounts.",
    auth: "oauth2",
    capabilities: ["pull_assets", "push_work_order"],
    popular: true,
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "crm",
    blurb: "Sync accounts & service tickets; surface maintenance insights to CS.",
    auth: "oauth2",
    capabilities: ["pull_people"],
  },

  // ── ATS / HRIS (workforce intelligence) ─────────────────────
  {
    key: "greenhouse",
    name: "Greenhouse",
    category: "ats",
    blurb: "Push skill-gap-driven candidate matches into your hiring pipeline.",
    auth: "api_key",
    capabilities: ["pull_people", "push_candidate_match"],
    popular: true,
  },
  {
    key: "lever",
    name: "Lever",
    category: "ats",
    blurb: "Match technicians to reqs based on the skills your plant actually needs.",
    auth: "oauth2",
    capabilities: ["pull_people", "push_candidate_match"],
  },
  {
    key: "workday",
    name: "Workday",
    category: "ats",
    blurb: "HRIS sync of technicians, roles, certifications & competencies.",
    auth: "oauth2",
    capabilities: ["pull_people"],
  },

  // ── Sensors / condition monitoring ──────────────────────────
  {
    key: "tractian",
    name: "Tractian",
    category: "sensors",
    blurb: "Vibration & current sensor alerts feed the Copilot automatically.",
    auth: "api_key",
    capabilities: ["pull_sensor_alerts", "pull_assets"],
    popular: true,
  },
  {
    key: "skf",
    name: "SKF Enlight",
    category: "sensors",
    blurb: "Bearing condition monitoring & alarms.",
    auth: "api_key",
    capabilities: ["pull_sensor_alerts"],
  },
  {
    key: "machinemetrics",
    name: "MachineMetrics",
    category: "sensors",
    blurb: "Machine downtime & utilization signals.",
    auth: "api_key",
    capabilities: ["pull_sensor_alerts", "pull_failures"],
  },
  {
    key: "fluke",
    name: "Fluke Connect",
    category: "sensors",
    blurb: "Handheld measurement & thermal data into asset history.",
    auth: "api_key",
    capabilities: ["pull_sensor_alerts"],
  },
];

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  cmms: "CMMS / EAM",
  erp: "ERP",
  crm: "CRM",
  ats: "ATS / HRIS",
  sensors: "Sensors & Condition Monitoring",
};

export function getConnector(key: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.key === key);
}
