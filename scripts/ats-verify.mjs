import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3991";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);
const BAD = /\bATS\b|HRIS|hiring brief|Hiring Brief|score candidate|Score candidate|Candidate Match|recruiting|requisition|Greenhouse|Lever\b|Workday/;

// /workforce → Team Skills, no recruiting
await p.goto(`${BASE}/workforce`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const wf = await p.locator("body").innerText();
log("workforce retitled Team Skills?", wf.includes("Team Skills"));
log("workforce free of recruiting terms?", !BAD.test(wf));
await p.screenshot({ path: `${SHOT}/ATS-teamskills.png` });

// /integrations → no ATS/HRIS category or connectors
await p.goto(`${BASE}/integrations`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const ig = await p.locator("body").innerText();
log("integrations free of ATS/HRIS?", !BAD.test(ig));
log("integrations keeps CMMS?", ig.includes("MaintainX") && ig.includes("Fiix"));
log("integrations keeps sensors?", ig.includes("Tractian"));
await p.screenshot({ path: `${SHOT}/ATS-integrations.png`, fullPage: true });

// Marketing page + Today + sidebar: no recruiting language anywhere
for (const [path, name] of [["/", "home"], ["/today", "today"], ["/help", "help"], ["/team", "team"]]) {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  const t = await p.locator("body").innerText();
  log(`${name} free of recruiting terms?`, !BAD.test(t));
}

// Sidebar must not link to workforce
await p.goto(`${BASE}/today`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const navLinks = await p.locator("aside a").allInnerTexts();
log("sidebar has no Workforce link?", !navLinks.some((t) => /workforce/i.test(t)));

// Core loop still works: PM + WO intact
await p.goto(`${BASE}/pm`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const pm = await p.locator("body").innerText();
log("PM page intact?", pm.includes("Due / Overdue") && pm.includes("Create Manual PM"));

await b.close();
log("ats-verify done");
