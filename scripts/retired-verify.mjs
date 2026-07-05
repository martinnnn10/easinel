import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3951";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);

// Default Equipment view: retired asset must be hidden, quiet link shown.
await p.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const body = await p.locator("body").innerText();
log("default view shows 'Pump 12' (retired)?", body.includes("Pump 12"));
log("default view shows 'Conveyor 3' (operational)?", body.includes("Conveyor 3"));
log("shows 'retired asset' hidden note?", /retired asset.*hidden/i.test(body));
await p.screenshot({ path: `${SHOT}/RET-default.png`, fullPage: true });

// Click "show" → retired filter reveals it.
await p.locator("button", { hasText: /^show$/ }).first().click();
await p.waitForTimeout(900);
const body2 = await p.locator("body").innerText();
log("after 'show': 'Pump 12' visible?", body2.includes("Pump 12"));
await p.screenshot({ path: `${SHOT}/RET-filtered.png`, fullPage: true });

// Today page still loads clean.
await p.goto(`${BASE}/today`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const t = await p.locator("body").innerText();
log("Today loads?", t.includes("Today"));
await b.close();
log("retired-verify done");
