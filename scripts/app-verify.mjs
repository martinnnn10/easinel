import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3971";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);

// Today → Ask Copilot button goes to /copilot
await p.goto(`${BASE}/today`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator("a", { hasText: /^Ask Copilot$/ }).first().click();
await p.waitForTimeout(900);
log("Today's Ask Copilot lands on /copilot?", p.url().includes("/copilot"));
const cb = await p.locator("body").innerText();
log("Copilot UI renders?", cb.includes("Copilot"));
await p.screenshot({ path: `${SHOT}/APP-copilot.png` });

// Sessions page: open a session → /copilot?c=
await p.goto(`${BASE}/sessions`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const rows = p.locator("[class]", { hasText: /Conveyor 3 keeps tripping/ });
log("sessions list shows seeded session?", (await p.locator("body").innerText()).includes("Conveyor 3 keeps tripping"));

// PM page tabs intact
await p.goto(`${BASE}/pm`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const pmb = await p.locator("body").innerText();
log("PM Due/Overdue tab?", pmb.includes("Due / Overdue"));
log("PM Create Manual button?", pmb.includes("Create Manual PM"));

// WO detail → WorkPackage present
await p.goto(`${BASE}/work-orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator("a[href^='/work-orders/wo']").first().click();
await p.waitForTimeout(1500);
const wob = await p.locator("body").innerText();
log("WO detail mentions Work Package?", /work package/i.test(wob));

// Marketing page in demo mode still public/no sidebar
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(700);
const mb = await p.locator("body").innerText();
log("marketing at / in demo mode too?", mb.includes("Stop solving the same breakdown twice"));

await b.close();
log("app-verify done");
