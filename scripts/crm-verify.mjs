import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3993";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);
const CRM = /\bCRM\b|Salesforce|HubSpot|Service Cloud|Field Service/;

// Integrations page: no CRM category or connectors; maintenance stack intact
await p.goto(`${BASE}/integrations`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const ig = await p.locator("body").innerText();
log("integrations free of CRM?", !CRM.test(ig));
log("integrations keeps CMMS (MaintainX/Fiix)?", ig.includes("MaintainX") && ig.includes("Fiix"));
log("integrations keeps ERP (SAP/Maximo)?", ig.includes("SAP") && ig.includes("Maximo"));
log("integrations keeps Sensors (Tractian)?", ig.includes("Tractian"));
log("no ATS residue?", !/\bATS\b|HRIS|Greenhouse|Workday/.test(ig));
await p.screenshot({ path: `${SHOT}/CRM-integrations.png`, fullPage: true });

// Public homepage: no CRM language
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
log("homepage free of CRM?", !CRM.test(await p.locator("body").innerText()));

// Sidebar unchanged: Daily/Maintenance/Advanced groups + core links present
await p.goto(`${BASE}/today`, { waitUntil: "networkidle" });
await p.waitForTimeout(700);
const nav = (await p.locator("aside").innerText());
log("sidebar groups intact?", ["DAILY","MAINTENANCE","ADVANCED"].every((g)=>nav.toUpperCase().includes(g)));
log("sidebar core links intact?", ["Today","Copilot","Work Orders","PM Program","Knowledge"].every((l)=>nav.includes(l)));
log("sidebar has no CRM/Workforce?", !CRM.test(nav) && !/workforce/i.test(nav));

// Core workflow spot-check
await p.goto(`${BASE}/pm`, { waitUntil: "networkidle" });
await p.waitForTimeout(700);
const pm = await p.locator("body").innerText();
log("PM workflow intact?", pm.includes("Due / Overdue") && pm.includes("Create Manual PM"));

await b.close();
log("crm-verify done");
