import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3931";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await p.goto(`${BASE}/today`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.screenshot({ path: `${SHOT}/NAV-today.png` });
// PM page to confirm it still renders
await p.goto(`${BASE}/pm`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.screenshot({ path: `${SHOT}/NAV-pm.png`, fullPage: true });
await b.close();
console.log("nav shots done");
