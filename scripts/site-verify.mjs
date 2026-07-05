import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3961";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const log = (...a) => console.log(...a);

// ── Desktop marketing page ──
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const body = await p.locator("body").innerText();
log("hero headline present?", body.includes("Stop solving the same breakdown twice"));
log("loop section present?", body.includes("Every breakdown makes your team smarter"));
log("CMMS section present?", body.includes("CMMS systems store maintenance data"));
log("trust section present?", body.includes("Built for plants, not demos"));
log("no app sidebar leaked?", !body.includes("Shift Handover") || !body.includes("PLC Explorer"));
log("no AI-provider banner leaked?", !body.includes("deterministic fallback"));
await p.screenshot({ path: `${SHOT}/SITE-hero.png` });
await p.screenshot({ path: `${SHOT}/SITE-full.png`, fullPage: true });

// ── Mobile marketing ──
const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await m.goto(`${BASE}/`, { waitUntil: "networkidle" });
await m.waitForTimeout(600);
await m.screenshot({ path: `${SHOT}/SITE-mobile.png` });
await m.close();

// ── Sign up → should land on /today ──
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const lb = await p.locator("body").innerText();
log("login shows create-org (fresh db)?", lb.includes("Create your organization"));
await p.screenshot({ path: `${SHOT}/SITE-login.png` });
// fill signup
const fields = p.locator("input");
await fields.nth(0).fill("Verification Plant");
await fields.nth(1).fill("Verify Owner");
await fields.nth(2).fill("owner@verify.test");
await fields.nth(3).fill("Str0ng-Passw0rd-4-Test");
await p.locator("button", { hasText: /Create organization/ }).click();
await p.waitForTimeout(2500);
log("after signup URL:", p.url());
const tb = await p.locator("body").innerText();
log("landed on Today?", p.url().includes("/today") && tb.includes("Today"));
await p.screenshot({ path: `${SHOT}/SITE-app-today.png` });

// ── Signed-in: Copilot at /copilot works ──
await p.goto(`${BASE}/copilot`, { waitUntil: "networkidle" });
await p.waitForTimeout(900);
const cb = await p.locator("body").innerText();
log("Copilot page loads signed-in?", cb.includes("Copilot"));

await b.close();
log("site-verify done");
