import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3941";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);

// Completion modal via Active tab → Mark done
await p.goto(`${BASE}/pm`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator("button", { hasText: /^active$/i }).first().click();
await p.waitForTimeout(500);
await p.locator("button", { hasText: /^Mark done$/ }).first().click();
await p.waitForTimeout(700);
const cm = await p.locator("body").innerText();
log("Completion modal opened?", cm.includes("Complete PM") && cm.includes("Parts used"));
await p.screenshot({ path: `${SHOT}/PMV-complete-modal.png` });

// Work order detail with WorkPackagePanel
await p.goto(`${BASE}/work-orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const firstWo = p.locator("a[href^='/work-orders/wo']");
const n = await firstWo.count();
log("work order links found:", n);
if (n) {
  await firstWo.first().click();
  await p.waitForTimeout(1800);
  const wo = await p.locator("body").innerText();
  log("WO detail mentions 'Work Package'?", /work package/i.test(wo));
  await p.screenshot({ path: `${SHOT}/PMV-wo-detail.png`, fullPage: true });
}
await b.close();
log("pm-verify2 done");
