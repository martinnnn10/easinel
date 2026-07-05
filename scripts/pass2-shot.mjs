import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3921";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const go = async (path, name, wait = 1200) => {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${SHOT}/P2-${name}.png`, fullPage: true });
  console.log(`shot ${name}`);
};
await go("/assets", "assets-list");
await go("/assets/ast_demo_conveyor3", "asset-detail");
await go("/dashboard", "dashboard", 1800);
await go("/pm", "pm-list");
await b.close();
console.log("pass2 shots done");
