import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR;
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await p.goto("http://127.0.0.1:4002/work-orders/wo_c0be8b22-0a6b-4f29-b709-abb8e15e019c", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator("button", { hasText: /^Close out$/ }).first().click();
await p.waitForTimeout(700);
const val = await p.locator("input[type=number]").first().inputValue();
console.log("downtime field prefilled value:", JSON.stringify(val));
// Failures dates present now?
await p.goto("http://127.0.0.1:4002/assets/ast_demo_conveyor3?tab=failures", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const ft = await p.locator("body").innerText();
console.log("Failures shows a date (20xx-xx-xx)?", /20\d\d-\d\d-\d\d/.test(ft));
await b.close();
