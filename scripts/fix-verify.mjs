import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR;
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await p.goto("http://127.0.0.1:4003/assets/ast_demo_conveyor3?tab=failures", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const t = await p.locator("body").innerText();
// Real F007 group still present
console.log("F007 group still shown?", /F007/.test(t) && /recurred/i.test(t));
// No false '20' group header (the symptoms all say '~20 min')
const has20Group = /×\d+\s*\n?\s*20\b/.test(t) || /\b20 has recurred/i.test(t);
console.log("no false '20' repeat group?", !has20Group);
// No bare 2-digit label as a group header
console.log("banner references F007 (not a bare number)?", /F007 has recurred/i.test(t));
await p.screenshot({ path: SHOT + "/FIX-failures.png", fullPage: true });
await b.close();
