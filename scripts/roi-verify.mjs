import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:4001";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);

// 1. HERO — "Seen before" card in the create-WO modal
await p.goto(`${BASE}/work-orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.locator("button", { hasText: /^\+ New$/ }).first().click();
await p.waitForTimeout(400);
await p.locator("textarea").first().fill("Conveyor 3 tripping on F007 overload again about 20 minutes into the run");
// select the Conveyor 3 asset
await p.locator("select").first().selectOption({ label: "Conveyor 3" }).catch(() => {});
await p.waitForTimeout(900); // debounce + fetch
const modalText = await p.locator("body").innerText();
log("'Seen before' card shows?", /Seen before/i.test(modalText));
log("shows prior fix + WO number?", /Last fix:/i.test(modalText) && /WO-/.test(modalText));
log("voice mic present in modal?", await p.locator("button[aria-label='Dictate symptom'], button[title='Dictate symptom']").count() > 0);
await p.screenshot({ path: `${SHOT}/ROI-seen-before.png` });
await p.keyboard.press("Escape").catch(() => {});
await p.waitForTimeout(300);

// 2. Failures tab grouped
await p.goto(`${BASE}/assets/ast_demo_conveyor3?tab=failures`, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const failText = await p.locator("body").innerText();
log("Failures shows repeat banner (recurred)?", /recurred/i.test(failText));
log("Failures shows occurrences grouping?", /occurrence/i.test(failText));
log("Failures shows Fix: inline?", /Fix:/i.test(failText));
await p.screenshot({ path: `${SHOT}/ROI-failures.png`, fullPage: true });

// 3. Close-out modal with downtime field (start a fresh WO first via UI is heavy; drive an in_progress WO)
// Use the open F007 WO — start then open close-out
await p.goto(`${BASE}/work-orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.locator("a[href^='/work-orders/wo']").first().click();
await p.waitForTimeout(1000);
// If it has a Start work button, click to reach in_progress; else Close out may show
const startBtn = p.locator("button", { hasText: /^Start work$/ });
if (await startBtn.count()) { await startBtn.first().click(); await p.waitForTimeout(800); }
const closeBtn = p.locator("button", { hasText: /^Close out$/ });
if (await closeBtn.count()) {
  await closeBtn.first().click();
  await p.waitForTimeout(700);
  const co = await p.locator("body").innerText();
  log("Close-out shows 'Actual downtime' field?", /Actual downtime/i.test(co));
  log("Close-out shows repeat heads-up?", /Heads up/i.test(co));
  log("Close-out resolution mic present?", await p.locator("button[aria-label='Dictate resolution'], button[title='Dictate resolution']").count() > 0);
  await p.screenshot({ path: `${SHOT}/ROI-closeout.png` });
  await p.keyboard.press("Escape").catch(() => {});
}

// 4. Metrics Value band
await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const dash = await p.locator("body").innerText();
log("Value band shows 'Downtime impact'?", /Downtime impact/i.test(dash));
log("Value band shows a $ figure?", /\$[\d,]/.test(dash));
log("Value band shows vs-prior delta?", /vs prior/i.test(dash));
await p.screenshot({ path: `${SHOT}/ROI-valueband.png` });

// 5. Today setup card new order (fresh org needed for the card; demo org has data so it won't show
//    — instead verify the ?ask= deep link lands a grounded answer)
await p.goto(`${BASE}/copilot?ask=${encodeURIComponent("A PowerFlex drive shows Fault F081 — what does it mean and what do I check?")}`, { waitUntil: "networkidle" });
await p.waitForTimeout(6000); // let the deterministic/live answer stream
const cop = await p.locator("body").innerText();
log("?ask= auto-sent the question?", /F081/i.test(cop));
log("?ask= produced an answer (not empty composer)?", cop.length > 400 && /answer|check|fault|drive/i.test(cop));
await p.screenshot({ path: `${SHOT}/ROI-onboarding-ask.png`, fullPage: true });

await b.close();
log("roi-verify done");
