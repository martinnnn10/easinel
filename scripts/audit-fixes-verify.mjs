import { chromium } from "playwright-core";
import { execSync } from "child_process";
const EXE = execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1").toString().trim();
const SHOT = process.env.SHOT_DIR, BASE = process.env.BASE || "http://127.0.0.1:3981";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const log = (...a) => console.log(...a);

// 1. Marketing page shows trial CTA + legal footer links
await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(700);
const home = await p.locator("body").innerText();
log("hero trial link?", home.includes("start a free 14-day trial"));
log("bottom 'Start a free trial'?", home.includes("Start a free trial"));
log("footer Privacy/Terms?", home.includes("Privacy") && home.includes("Terms"));

// 2. /privacy renders without sidebar
await p.goto(`${BASE}/privacy`, { waitUntil: "networkidle" });
await p.waitForTimeout(500);
const priv = await p.locator("body").innerText();
log("privacy renders?", priv.includes("Organization isolation"));
log("privacy has no app sidebar?", !priv.includes("PM Program"));
await p.screenshot({ path: `${SHOT}/AF-privacy.png` });

// 3. Signup deep-link: /login?signup=1 must open Create-organization even though a user exists.
//    First create user #1 via API to make hasUsers true.
const r1 = await p.request.post(`${BASE}/api/auth/signup`, {
  data: { orgName: "First Plant", name: "First Owner", email: "first@verify.test", password: "Str0ng-Pass-111" },
});
log("bootstrap org created?", r1.status() === 200 || r1.status() === 201);
// fresh context (no session)
const c2 = await b.newContext({ viewport: { width: 1440, height: 950 } });
const p2 = await c2.newPage();
await p2.goto(`${BASE}/login?signup=1`, { waitUntil: "networkidle" });
await p2.waitForTimeout(900);
const lg = await p2.locator("body").innerText();
log("?signup=1 opens Create your organization?", lg.includes("Create your organization"));
await p2.screenshot({ path: `${SHOT}/AF-signup.png` });

// 4. New org signup → Today shows the setup card (fresh org, no data)
const flds = p2.locator("input");
await flds.nth(0).fill("Second Plant");
await flds.nth(1).fill("Second Owner");
await flds.nth(2).fill("second@verify.test");
await flds.nth(3).fill("Str0ng-Pass-222");
await p2.locator("button", { hasText: /Create organization/ }).click();
await p2.waitForTimeout(2500);
log("landed on /today?", p2.url().includes("/today"));
const today = await p2.locator("body").innerText();
log("setup card shows?", today.includes("Set up your plant") && today.includes("Add your first machine"));
await p2.screenshot({ path: `${SHOT}/AF-today-setup.png`, fullPage: true });

await b.close();
log("audit-fixes-verify done");
