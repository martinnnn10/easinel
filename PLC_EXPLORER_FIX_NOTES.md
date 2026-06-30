# PLC Knowledge Explorer — Bug/Fix Notes (for Cursor)

This package contains the full **EAS Industrial Copilot** source (Next.js 15, App Router)
with a newly built **PLC Knowledge Explorer** feature and the fix for the reported
bug: *"still not clickable after I upload the ACD file."*

## TL;DR of the fix
Uploaded PLC files (`.L5X` / `.ACD`) were parsed and stored correctly, and the
PLC Explorer at `/plc` and `/plc/[id]` worked — but there was **no path from the
uploaded document into the Explorer**. On the **Knowledge** page every document
rendered as a non-interactive row, so clicking the file you just uploaded did
nothing. That is the "dead click."

### What changed
1. **`src/app/api/knowledge/route.ts`** — the knowledge list now joins PLC projects
   and attaches `plcProjectId` + `plcFidelity` to any document that was parsed as a
   PLC project (via `listPlcProjects()` keyed by `documentId`). Degrades gracefully
   if the PLC store is unavailable.
2. **`src/app/knowledge/page.tsx`** — PLC document rows are now **clickable**
   (`role="button"`, keyboard-activatable) and navigate to `/plc/{plcProjectId}`.
   A clear **"Open in PLC Explorer →"** affordance and a `full structure` /
   `summary only` fidelity hint are shown. After uploading a PLC file the page now
   **auto-redirects** straight into the Explorer (using `results[].plcProjectId`
   returned by `/api/upload`), so the user never lands on a dead-end row.

No DB schema change was required for the fix; `plc_projects` already stores
`document_id`. The upload pipeline (`src/lib/rag/ingest.ts`) already returns
`plcProjectId`/`plcFidelity`.

## How the whole feature is wired (orientation for Cursor)
- **Parser/IR**: `src/lib/plc/ir.ts`, `parseL5X.ts` (full structure), `parseACD.ts`
  (summary-only — reads controller name, firmware revision from the ACD save
  history, created/last-saved dates, save count; does NOT fabricate a catalog
  number, since it is not stored in plaintext). `nodes.ts` resolves a node id to
  detail data; `store.ts` persists/loads the IR and produces RAG summary text.
- **Ingest hook**: `src/lib/rag/ingest.ts` detects `.l5x/.acd`, parses to IR,
  persists via `savePlcProject`, and indexes a compact summary for the Copilot RAG.
- **API**: `src/app/api/plc/route.ts` (list), `/api/plc/[id]/route.ts` (tree+meta),
  `/api/plc/[id]/node/route.ts` (node detail + click-path logging via
  `src/lib/plc/clicklog.ts`), `/api/plc/[id]/search/route.ts`,
  `/api/plc/[id]/explain/route.ts` (AI explanation; live + demo fallback).
- **UI**: `src/app/plc/page.tsx` (project list), `src/app/plc/[id]/page.tsx`
  (VS Code-style workspace: tree + breadcrumbs + search + detail, keyboard nav,
  `?node=` deep-linking). Components in `src/components/plc/`:
  `Tree.tsx`, `DetailPanel.tsx`, `icons.tsx`.
- **Seed**: `src/lib/seed.ts` + `src/lib/plc/sampleConv3L5X.ts` preload a realistic
  `Conveyor3_PKG2.L5X` (1769-L24ER, PowerFlex 525) so the Explorer demos out of the box.

## .ACD vs .L5X (by design)
- **.L5X** → full fidelity: controller, tasks, programs, routines (RLL rungs + ST),
  controller/program tags with cross-references, AOIs, UDTs, I/O modules.
- **.ACD** → `fidelity: "summary"`: native proprietary binary, so only summary
  metadata is read. The controller node shows a clear notice with exact Studio 5000
  **Export → .L5X** steps. This is intentional, not a bug.

## Run locally
```bash
npm install
npm run build      # Next.js output: "standalone"
# standalone server (reads DATABASE_URL + PORT/HOSTNAME from process env):
cp .env.example .env   # or set DATABASE_URL=file:./data/local.db
node .next/standalone/server.js   # ensure .next/static and public are copied in, and a ./data dir exists
```
The DB self-initializes and seeds the Conveyor 3 demo on first request.

## Quick verification of the fix
1. Go to **Knowledge → Upload**, choose an `.ACD` or `.L5X`.
2. You are redirected into **PLC Explorer**; or return to Knowledge and click the
   PLC row — it opens `/plc/{id}` and the controller node renders (summary notice
   for .ACD, full tree for .L5X). No dead click.
