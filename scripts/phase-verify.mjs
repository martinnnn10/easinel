import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR;
const BASE = process.env.BASE || "http://localhost:3911";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const results = [];
const ok = (n, c, d = "") => { results.push({ n, c }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

// ---- Admin banner: "Live AI provider not configured" ----
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const bodyTop = (await page.textContent("body")) || "";
ok("#3 admin banner shows fallback warning", /live ai provider not configured/i.test(bodyTop));
await page.screenshot({ path: `${SHOT}/P-banner.png` });

// ---- Copilot: F004 direct answer first ----
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const ta = page.locator("textarea").first();
await ta.fill("What code is under voltage for a PowerFlex drive?");
await ta.press("Enter");
// wait for the streamed answer
await page.waitForTimeout(6000);
const ans = (await page.textContent("body")) || "";
const idxAnswer = ans.indexOf("Answer");
const idxF004 = ans.indexOf("F004");
const idxSources = ans.search(/Sources|Retrieval diagnostics/i);
ok("#2 Copilot answers F004 directly", idxF004 >= 0 && /F004\s*[—-]\s*UnderVoltage|F004 \(UnderVoltage\)/i.test(ans));
ok("#2 answer appears before sources", idxAnswer >= 0 && (idxSources < 0 || idxAnswer < idxSources));
ok("#2 not a raw passage dump", !/what your documents say/i.test(ans));
ok("#5 provider labeled (deterministic fallback)", /deterministic fallback/i.test(ans));
await page.screenshot({ path: `${SHOT}/P-copilot-f004.png`, fullPage: true });

// ---- Shift Handover editable: add a note, board + digest update ----
await page.goto(`${BASE}/handover`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT}/P-handover-empty.png` });
const addBtn = page.locator('button:has-text("Add handover note"), button:has-text("Add the first note")').first();
await addBtn.click().catch(() => {});
await page.waitForTimeout(700);
// fill the modal
await page.locator('select').first().selectOption("machine_down").catch(() => {});
await page.locator('textarea').first().fill("Line 2 conveyor VFD tripping F007 — left it locked out for next shift.").catch(() => {});
await page.locator('button:has-text("Save note")').click().catch(() => {});
await page.waitForTimeout(1500);
const hb = (await page.textContent("body")) || "";
ok("#3 handover accepts a manual note (board updates)", /conveyor VFD tripping F007/i.test(hb));
ok("#3 digest builds from the entered note", /Machine down/i.test(hb) && /conveyor VFD tripping/i.test(hb));
await page.screenshot({ path: `${SHOT}/P-handover-note.png`, fullPage: true });

await b.close();
const pass = results.filter(r => r.c).length;
console.log(`\n==== ${pass}/${results.length} checks passed ====`);
if (pass !== results.length) process.exitCode = 1;
