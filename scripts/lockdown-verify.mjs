import { chromium } from "playwright-core";
import { execSync } from "child_process";

const EXE =
  execSync("ls -d /opt/pw-browsers/chromium*/chrome-linux/chrome 2>/dev/null | head -1")
    .toString()
    .trim();
const SHOT = process.env.SHOT_DIR;
const DEFAULT = "http://localhost:3901"; // mandatory login
const DEMO = "http://localhost:3902"; // demo content

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });

// ─────────────────────────────────────────────────────────────────────────
// PART A — mandatory login server (empty production workspace)
// ─────────────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // #4 — protected route requires login (redirects to /login)
  const resp = await page.goto(`${DEFAULT}/assets`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  ok("#4 protected /assets redirects to /login", page.url().includes("/login"), page.url());
  await page.screenshot({ path: `${SHOT}/A1-login-redirect.png` });

  // First-run should offer "Create your organization"
  const bodyText = await page.textContent("body");
  ok("#5 first run offers org creation (signup)", /create your organization|create an organization/i.test(bodyText || ""));

  // Bootstrap the owner via the signup form (fields are placeholder-labelled).
  await page.fill('input[placeholder*="Acme"]', "Aguilar Manufacturing").catch(() => {});
  await page.fill('input[placeholder*="Jane"]', "Martin").catch(() => {});
  await page.fill('input[type="email"]', "owner@aguilar.test").catch(() => {});
  await page.fill('input[type="password"]', "lockdown-pass-9").catch(() => {});
  await page.screenshot({ path: `${SHOT}/A2-signup-filled.png` });
  await page.click('button:has-text("Create organization")').catch(() => {});
  await page.waitForTimeout(2000);
  ok("#5 owner bootstrap signs in (leaves /login)", !page.url().includes("/login"), page.url());

  // #2 — production workspace starts clean (empty equipment)
  await page.goto(`${DEFAULT}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const assetsText = (await page.textContent("body")) || "";
  ok("#1/#2 no Conveyor/demo asset in production", !/conveyor|pump 12|powerflex 525/i.test(assetsText));
  await page.screenshot({ path: `${SHOT}/A3-assets-empty.png` });

  // #8 — knowledge empty + clean
  await page.goto(`${DEFAULT}/knowledge`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const kText = (await page.textContent("body")) || "";
  ok("#1 no demo docs in production knowledge", !/conveyor 3|powerflex 525|e-conv3/i.test(kText));
  await page.screenshot({ path: `${SHOT}/A4-knowledge-empty.png` });

  // #9 — PM page clean
  await page.goto(`${DEFAULT}/pm`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOT}/A5-pm-empty.png` });

  // #7 — scenarios: user-created only (empty for a fresh org)
  await page.goto(`${DEFAULT}/scenarios`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const scText = (await page.textContent("body")) || "";
  ok("#7 scenarios empty for fresh org (no canned)", !/conveyor 3|f007/i.test(scText));
  await page.screenshot({ path: `${SHOT}/A6-scenarios-empty.png` });

  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────
// PART B — demo server (has content) → click Knowledge + PM workflows live
// ─────────────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await ctx.newPage();

  // #8 — Knowledge: documents clickable → real detail page
  await page.goto(`${DEMO}/knowledge`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOT}/B1-knowledge-list.png` });
  // Click the first document row (rows are role="button" → openDoc()).
  let opened = false;
  const docRow = page.locator('[role="button"]').filter({ hasText: /\.pdf|\.txt|\.md|\.l5x|drawing|conveyor|lesson|work order/i }).first();
  if (await docRow.count()) {
    await docRow.click().catch(() => {});
    await page.waitForTimeout(1200);
    const dt = (await page.textContent("body")) || "";
    opened = /extracted text|open original|indexing|linked machine|download/i.test(dt);
  }
  ok("#8 clicking a document opens a real detail view", opened);
  await page.screenshot({ path: `${SHOT}/B2-knowledge-detail.png` });

  // #9 — PM page is asset-first (Guided PM builder: "Machine first").
  await page.goto(`${DEMO}/pm`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOT}/B3-pm-list.png` });
  const pmPageText = (await page.textContent("body")) || "";
  ok("#9 PM page is asset-first (machine-first guided builder)", /machine first|what are we maintaining|identify the asset/i.test(pmPageText));

  // #9 (real workflow) — ASSET-FIRST PM generation: open Conveyor 3, generate a
  // PM from the machine, then open the generated program's procedure-grade detail.
  await page.goto(`${DEMO}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const conv = page.locator('text=/Conveyor 3/i').first();
  if (await conv.count()) {
    await conv.click().catch(() => {});
    await page.waitForTimeout(1200);
    // Go to the PMs tab on the asset, then click a Generate button.
    const pmTab = page.locator('button, [role="tab"], a').filter({ hasText: /^PMs$|PM program|PMs/ }).first();
    if (await pmTab.count()) { await pmTab.click().catch(() => {}); await page.waitForTimeout(600); }
    const genBtn = page.locator('button').filter({ hasText: /generate/i }).first();
    if (await genBtn.count()) {
      await genBtn.click().catch(() => {});
      await page.waitForTimeout(6000); // generation runs the offline engine
      await page.screenshot({ path: `${SHOT}/B6-asset-pm-generated.png` });
      const at = (await page.textContent("body")) || "";
      ok("#9 asset-first PM generation produces a program", /draft|program|procedure|step|review|approve/i.test(at));
      // Open the first generated PM detail.
      const pmDetail = page.locator('a[href^="/pm/"]').first();
      if (await pmDetail.count()) {
        await pmDetail.click().catch(() => {});
        await page.waitForTimeout(1500);
        const pt = (await page.textContent("body")) || "";
        ok("#9 generated PM detail is procedure-grade (steps + safety + interval)",
          /procedure/i.test(pt) && /(safety|ppe|lockout)/i.test(pt) && /(interval|frequency|day|month)/i.test(pt));
        await page.screenshot({ path: `${SHOT}/B7-pm-detail-procedure.png` });
      }
    } else {
      ok("#9 asset PM Generate button present", false, "no generate button found");
    }
  }

  // #3 — demo workspace DOES show demo data (isolation counterpart)
  await page.goto(`${DEMO}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const demoAssets = (await page.textContent("body")) || "";
  ok("#3 demo workspace shows demo asset (isolated fixture)", /conveyor 3/i.test(demoAssets));
  await page.screenshot({ path: `${SHOT}/B5-demo-assets.png` });

  await ctx.close();
}

await browser.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\n==== ${passed}/${results.length} checks passed ====`);
if (passed !== results.length) process.exitCode = 1;
