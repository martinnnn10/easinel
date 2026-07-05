import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3941";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);

await p.goto(`${BASE}/pm`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.screenshot({ path: `${SHOT}/PMV-all.png`, fullPage: true });

// Confirm tabs present
const tabs = await p.locator("button").allInnerTexts();
log("TABS/labels sample:", tabs.filter(t => /all|draft|active|due|archived/i.test(t)).join(" | "));

// Default All must NOT show the archived PM title
const bodyAll = await p.locator("body").innerText();
log("All-view shows 'Annual thermographic scan' (archived)?", bodyAll.includes("Annual thermographic scan"));
log("All-view shows 'Quarterly gearbox oil change' (active)?", bodyAll.includes("Quarterly gearbox oil change"));
log("All-view shows 'Due / Overdue' tab?", bodyAll.includes("Due / Overdue"));

// Click Archived tab
const arch = p.locator("button", { hasText: /^Archived/ });
if (await arch.count()) {
  await arch.first().click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${SHOT}/PMV-archived.png`, fullPage: true });
  const bodyArch = await p.locator("body").innerText();
  log("Archived-view shows the archived PM?", bodyArch.includes("Annual thermographic scan"));
}

// Back to All, open manual PM modal
await p.locator("button", { hasText: /^all$/i }).first().click().catch(()=>{});
await p.waitForTimeout(300);
await p.locator("button", { hasText: /Create Manual PM/i }).first().click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${SHOT}/PMV-manual-modal.png` });
const modal = await p.locator("body").innerText();
log("Manual modal opened?", modal.includes("Create Manual PM") && modal.includes("Frequency"));
await p.keyboard.press("Escape").catch(()=>{});

// Due tab
await p.locator("button", { hasText: /Due \/ Overdue/ }).first().click().catch(()=>{});
await p.waitForTimeout(500);
await p.screenshot({ path: `${SHOT}/PMV-due.png` });

// Completion modal: go to active tab, click Mark done
await p.locator("button", { hasText: /^active$/i }).first().click().catch(()=>{});
await p.waitForTimeout(500);
const md = p.locator("button", { hasText: /^Mark done$/ });
if (await md.count()) {
  await md.first().click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${SHOT}/PMV-complete-modal.png` });
  const cm = await p.locator("body").innerText();
  log("Completion modal opened?", cm.includes("Complete PM") && cm.includes("Parts used"));
  await p.keyboard.press("Escape").catch(()=>{});
}

// Work order detail with WorkPackagePanel
await p.goto(`${BASE}/work-orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
const firstWo = p.locator("a[href^='/work-orders/']");
if (await firstWo.count()) {
  await firstWo.first().click();
  await p.waitForTimeout(1500);
  const wo = await p.locator("body").innerText();
  log("WO detail mentions Work Package?", /work package/i.test(wo));
  await p.screenshot({ path: `${SHOT}/PMV-wo-detail.png`, fullPage: true });
}

await b.close();
log("pm-verify done");
