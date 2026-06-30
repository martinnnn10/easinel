# Asset-First Redesign — Maintenance Workflow

> "Stop building around PMs. Start building around Assets. A PM should never
> exist independently. A technician does not begin by saying *I need a PM* — they
> begin by identifying the machine."

This document captures the product direction and tracks what has shipped vs.
what remains. The north star: **the software mirrors how maintenance departments
actually organize work in a plant — around the machine — not how a database
organizes records.**

---

## The principle

Every PM, work order, drawing, PLC program, lesson learned, part, and AI
conversation **belongs to an asset** (machine → component → system). If a machine
can't be identified, the workflow guides the user to create it *before* the work
record can be saved. **There are no orphan records. No exceptions.**

The mental model a technician uses:

```
Conveyor 4  →  Quarterly Inspection        (machine first, then the task)
Motor 32    →  Monthly Lubrication
```

…never `Annual PM · Unassigned`.

---

## What shipped in this change

### 1. Orphan PMs are eliminated — enforced at the data layer
A PM can no longer be persisted without an asset. The rule lives at the single PM
data-access chokepoint (`src/lib/pm/repository.ts → createProgram`), the same
place tenancy is enforced, so **every** path obeys it:

- **`createProgram` throws** if `assetId` is missing.
- **PM generation** (`src/lib/pm/generate.ts`) — when a free-text
  manufacturer/model/serial matches no existing machine, it now **registers the
  machine from its nameplate identity** and links all five cadences to it. The
  machine comes first, even when the user started from a model number.
- **Manual PM create** (`POST /api/pm`) returns a clear 400 ("A PM must belong to
  a machine…") instead of saving an orphan.
- **Work-order → PM suggestion** (`POST /api/pm/suggest`) returns 422 guidance
  ("…assign an asset to the work order first…") when the source WO has no machine.

Covered by tests in `src/lib/pm/repository.test.ts` (orphan rejected) and
`src/lib/pm/generate.test.ts` (every generated PM is asset-linked).

### 2. Asset-first navigation
**Equipment** now leads the sidebar (`src/components/Sidebar.tsx`). The machine is
the entry point; work orders, PMs, parts, knowledge, and PLC hang off it.

### 3. PMs are generated *from* the machine
The asset page (`/assets/[id]`) Overview now has **Generate PM program**, which
calls the generator with this asset's id. The flow is asset → PM, not PM → asset.
The standalone PM screen still works (it already confirms/creates the machine
before saving), but the canonical path now starts at the equipment.

---

## What shipped next (the full asset-first workflow)

### 4. Search / scan / photo-first machine entry
The Equipment page now opens with **"What machine are you working on?"**
(`src/components/MachineFinder.tsx`):
- Search across asset number / serial / model / name.
- **Scan QR** — live camera scan via the browser `BarcodeDetector` (Chromium),
  with an honest fallback where the API isn't available.
- **Take a picture** — captures the nameplate and reads it through the vision
  model when live (`POST /api/assets/identify`), degrading honestly otherwise.
- **Disambiguation** — "Found N possible machines — which one?", each opening the
  asset; if nothing matches, **create the machine** right there.

### 5. Machine action hub
The asset page header now carries the action menu a tech actually uses:
**Repair · Inspect · Create PM · View History · View Drawings · View PLC · Find
Parts.** Repair/Inspect open a work order already scoped to that machine
(`/work-orders?asset=…&type=…&new=1`).

### 6. Guided "what are we maintaining?" PM builder
`src/components/GuidedPmBuilder.tsx` walks Component → Manufacturer → Model →
Serial → **find/confirm the machine** → generate. It refuses to start from a bare
cadence; the PM is always linked to a real asset (existing or created in-flow).

### 7. Expanded asset tabs
The digital twin gained first-class **PMs · Parts · Failures · Lessons** tabs
(alongside Work Orders / Drawings & Docs / PLC / Alarms / Sessions / Ask AI). The
twin payload now includes the machine's linked **parts** (and where they're used).

### 8. Orphan-PM backfill audit
`npm run audit:orphan-pms` reports any legacy PMs with no asset so they can be
assigned. New orphans are already impossible.

---

## Why this matters

The differentiator isn't "AI bolted onto a CMMS." It's that the product is shaped
the way an experienced maintenance manager would build it if CMMS conventions had
never existed: the machine is the organizing object, and intelligence is grounded
in that machine's real history.
