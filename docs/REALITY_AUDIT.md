# EAS Intelligence — Reality Audit

**Date:** 2026-07-01. **Method:** direct code inspection of the live tree (routes,
components, repositories, seed/demo logic, AI layer, theme). This audit lists what
is **actually wired end-to-end** vs. what is **UI-only, mock, dead, or leaking demo
content**, classified by severity. Fixes proceed Critical → High first.

Severity: **Critical** = breaks a core promise or leaks fake data into production ·
**High** = visible broken workflow / trust issue · **Medium** = incomplete but not
misleading · **Low** = polish.

---

## CRITICAL

### C1 — Knowledge page: uploaded documents are a dead click
`src/app/knowledge/page.tsx` → `openDoc()` starts with `if (!d.plcProjectId) return;`.
**Only PLC files are clickable.** Electrical drawings, manuals, PDFs, PM docs, images,
spreadsheets — clicking them does nothing. There is:
- **no document detail view** (drawer or page),
- **no single-document API** (`/api/knowledge` only lists),
- **no route to open/download the original file** (schema has `storagePath`, nothing serves it),
- **no extracted-text/chunk preview** surfaced in the UI.
The upload succeeds and indexes text, but the user has no way to open or review it.
This is the reported "uploads save but cannot be opened."

### C2 — Fake "Conveyor 3 / PowerFlex 525" content shown in production
- `src/components/Copilot.tsx` hardcodes suggested questions: *"Conveyor 3 trips after
  20 minutes."*, *"Why does Conveyor 3 keep failing?"*, *"My PowerFlex 525 shows Fault
  F081."* — rendered for **every** org, including a clean production workspace.
- `src/lib/ai/demo.ts` returns **canned, machine-specific answers** (VFD-CONV3 panel,
  filter PF-3, Pump 12 history) as the no-API-key fallback. In a production deploy
  without a live model key, the Copilot presents fabricated specifics **as if grounded
  in the customer's data**. Violates "no fake AI fallback answers / canned scenarios."

> Note — legitimately generic and NOT fake (keep): the `assetType` taxonomy value
> "conveyor" in pickers, the conveyor **PM procedure templates** in `pm/procedure.ts`
> (real domain knowledge applied to real conveyor assets), and the OEM reference
> library. These are equipment *categories/knowledge*, not fake customer *scenarios*.

### C3 — Authentication is optional by default ("open mode")
`src/lib/auth/session.ts`: when `AUTH_REQUIRED !== "true"`, every request resolves to a
synthetic `open-mode` user and protected pages are reachable with no login. The product
rule mandates login per organization. **Production must run with `AUTH_REQUIRED=true`;**
open mode should be demo-only. Needs enforcement + a deploy guard, not just docs.

---

## HIGH

### H1 — Visual system reads "startup SaaS blue," not industrial
`--color-accent: #4d87f5` (saturated blue) is used pervasively; the base
(`#090b10`/`#0c0f16`) carries a navy tint. Direction: neutralize the base to true
graphite/charcoal, mature/desaturate the accent, and reserve blue for primary actions,
links, selected, and focus only. ("Rockwell/Ignition command center," not flashy.)

### H2 — No Scenario Builder (required product capability)
There is no way for a user to author a training/troubleshooting **scenario** from their
plant reality (asset, symptom, fault code, root cause, corrective action, lesson, etc.).
No `scenarios` table, repository, API, or UI. This is a net-new capability the rules
require; it must be org-scoped, asset-first, owned, and audited.

### H3 — Electrical-drawing intelligence is not implemented
Drawings upload and their text is indexed like any document, but there is **no drawing-
specific extraction** (title/number/rev, equipment tags, panel names, PLC refs, wire
numbers) and no drawing-scoped Q&A surface. Image-based PDFs are not OCR'd. The UI must
say this honestly rather than imply drawings are "read."

---

## MEDIUM

### M1 — Demo fallback lacks an honest "not enough grounding" default
When the deterministic engine has no matching canned case, it should answer strictly from
retrieved sources and say plainly when it can't — never fabricate. Verify/repair the
default branch of `buildDemoAnswer`.

### M2 — Asset-first prompts are enforced for PMs but not for documents/drawings
PMs already reject orphans (good). Uploaded documents/drawings can remain unlinked with no
"Needs asset assignment" affordance. Rules want asset-first across documents too.

### M3 — Original-file storage may be ephemeral
Without `STORAGE_S3_*`, uploads go to a local `./uploads` folder (not durable on
ephemeral hosting). The "open original" path (C1) must degrade honestly when the binary
isn't retrievable.

---

## LOW

- L1 — Work-order "what's down" placeholder uses "Conveyor 3…" example text (cosmetic;
  make it generic).
- L2 — Accessibility baseline exists (skip link, focus, landmarks) but no full WCAG-AA
  audit on the new detail surfaces yet.

---

## What IS real (verified wired, not mock)

To be fair and precise about the platform's actual state:
- Multi-tenant isolation (`orgId` on every row/query), RBAC, audit log, sessions — real
  and test-proven.
- Work-order lifecycle (open→in-progress→done) with true downtime, optimistic-concurrency
  guard, idempotent transitions, and auto-captured Maintenance-Memory lessons — real.
- Demo **database** seed is correctly isolated to `org_demo` and gated off in production
  (`SEED_DEMO_ORG=false`); the DB does not seed fake rows into `org_prod`. (The leakage in
  C2 is **UI/AI-layer hardcoding**, not DB seed.)
- Hybrid retrieval (lexical+vector), citations, confidence, PM generation grounded in real
  history, parts memory — real when a model key is present.
- API error-safety, validation, rate limiting, OWASP headers, CI — real (recent rounds).

---

## Fix order (this and following batches)

1. **C1 Knowledge detail** — single-doc API (text/chunks/linked asset/status) + original-
   file open/download route + detail drawer so every document opens. *(this batch)*
2. **C2 Remove fake production content** — asset-driven/generic Copilot suggestions; make
   the fallback honest (no fabricated machine specifics outside `org_demo`). *(this batch)*
3. **H1 De-blue theme** — neutral graphite base, matured accent. *(this batch)*
4. **C3 Auth enforcement** + deploy guard. *(next)*
5. **H2 Scenario Builder** (schema→repo→API→UI, org-scoped, asset-first, audited). *(next)*
6. **H3 Electrical-drawing extraction** (honest, with clear "not OCR'd" messaging). *(next)*

Every fix is verified with `npm test`, `npm run build`, **and an actual browser
click-through** before being claimed complete.
