import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR;
const BASE = "http://localhost:3907";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

// Bootstrap owner
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.fill('input[placeholder*="Acme"]', "Aguilar Manufacturing").catch(() => {});
await page.fill('input[placeholder*="Jane"]', "Martin").catch(() => {});
await page.fill('input[type="email"]', "owner@aguilar.test").catch(() => {});
await page.fill('input[type="password"]', "lockdown-pass-9").catch(() => {});
await page.click('button:has-text("Create organization")').catch(() => {});
await page.waitForTimeout(2500);
console.log("after signup url:", page.url());

// Paywall must NOT lock us out (Stripe unconfigured → fail-open)
await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
console.log("assets url (should NOT be /billing):", page.url());
const lockedOut = page.url().includes("/billing");
console.log(lockedOut ? "FAIL paywall locked out" : "PASS paywall inactive (no lockout)");

// Dashboard renders
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const dt = (await page.textContent("body")) || "";
const dashOk = /mttr|mtbf|compliance|downtime|work order|dashboard/i.test(dt) && !page.url().includes("/billing");
console.log(dashOk ? "PASS dashboard renders" : "FAIL dashboard");
await page.screenshot({ path: `${SHOT}/M1-dashboard.png` });

// Billing page reachable + honest when Stripe unconfigured
await page.goto(`${BASE}/billing`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT}/M2-billing.png` });

await b.close();
