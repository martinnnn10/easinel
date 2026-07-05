# EAS Industrial Copilot

**The AI Operating System for Manufacturing Maintenance.**

Not a CMMS clone. This is the application a maintenance
technician, controls engineer, planner, reliability engineer, or maintenance
manager opens dozens of times a day to **solve real problems in seconds** —
troubleshooting, RCA, PMs, work orders, and document-grounded answers.

This repo is **Phase 1 (MVP): the AI Maintenance Copilot.**

---

## What's in Phase 1

- **Copilot chat** (`/`) — ChatGPT-style streaming answers, but every diagnostic
  reply is forced into the EAS structure: **Summary → Probable Causes (with
  confidence) → Troubleshooting Order → Safety → Tools → Spare Parts →
  Estimates (repair time / downtime / confidence) → Technical Explanation →
  References.**
- **Upload anything** — schematics, PLC exports (`.l5x`/`.acd`/`.scl`…), manuals,
  equipment photos, alarm history, vibration reports, PDFs. Text is auto-chunked
  and indexed; images are passed to Claude vision in live mode.
- **Knowledge base** (`/knowledge`) — every uploaded document, auto-classified
  (manual / drawing / PLC / photo / alarm / vibration / SOP) and retrieved on
  every question.
- **Equipment profiles** (`/assets`) — give each machine its own profile and its
  own AI conversation grounded in that asset's documents and history
  ("Why has this motor failed three times?").
- **Domain brain** — Allen-Bradley / Siemens / Omron, VFDs & servos, hydraulics,
  pneumatics, robotics, instrumentation, networking, motors/gearboxes/bearings,
  conveyors & packaging, across food/bakery/dairy/beverage, plastics,
  distribution, cold storage, utilities. RCA / RCM / TPM / PdM / PM aware.
- **Enterprise bones** — multi-tenant schema (orgId on every row), append-only
  audit log, role-ready structure.

## Runs with zero setup

The app works **out of the box in demo mode** (curated, correctly-structured
answers + real document retrieval) with no API key and a local file database.
Add an Anthropic key to switch the brain to **live Claude reasoning** grounded in
your uploaded documents.

```bash
npm install
cp .env.example .env.local   # optional — add ANTHROPIC_API_KEY to go live
npm run dev
# open http://localhost:3000
```

## Tech stack

| Concern        | Phase 1 (local, zero-config)      | Production target            |
| -------------- | --------------------------------- | ---------------------------- |
| Framework      | Next.js 15 (App Router) + TS      | same                         |
| UI             | Tailwind v4, dark, ChatGPT-feel   | same                         |
| AI             | Anthropic Claude (streaming)      | + OpenAI, model routing      |
| ORM / schema   | Drizzle ORM                       | same Drizzle schema          |
| Database       | libSQL/SQLite file (`local.db`)   | hosted libSQL/Turso → Postgres |
| File storage   | local `./uploads`                 | S3-compatible bucket           |
| Retrieval      | keyword TF retrieval over chunks  | **vector DB** (drop-in)      |
| Workers        | inline ingest                     | background queue             |

The retrieval interface (`src/lib/rag/retrieve.ts`), the DB layer
(`src/lib/db`), and the storage layer (`src/lib/storage.ts`) are isolated so
swapping in pgvector + Postgres + object storage is a config change, not a
rewrite.

## Deploying on ephemeral hosting (Manus, serverless, containers)

The local defaults (file DB + `./uploads`) are **not durable** if the host has
no persistent disk. Set these and nothing is lost on restart — no code changes:

1. **Database → hosted libSQL/Turso** (the app already speaks libSQL):
   ```
   DATABASE_URL=libsql://<your-db>.turso.io
   DATABASE_AUTH_TOKEN=<token>
   ```
2. **Uploads → any S3-compatible bucket** (Cloudflare R2, AWS S3, B2, MinIO):
   ```
   STORAGE_S3_BUCKET=...
   STORAGE_S3_ACCESS_KEY_ID=...
   STORAGE_S3_SECRET_ACCESS_KEY=...
   STORAGE_S3_ENDPOINT=...            # R2/B2/MinIO only
   STORAGE_S3_FORCE_PATH_STYLE=true  # R2/MinIO
   ```
3. **AI → live Claude:** `ANTHROPIC_API_KEY=...`

Build & run: `npm install && npm run build && npm run start` (binds `$PORT`).
See `.env.example` for the full list.

**Turnkey config:** a non-secret `.env` is shipped with `DATABASE_URL` already
pointing at the durable Turso database — so the only secret you must add on the
host is `DATABASE_AUTH_TOKEN` (plus optional `ANTHROPIC_API_KEY`).

**Docker:** the repo includes a `Dockerfile` (Next.js standalone output) for
container hosts:
```
docker build -t eas-copilot .
docker run -p 3000:3000 -e DATABASE_AUTH_TOKEN=... -e ANTHROPIC_API_KEY=... eas-copilot
```

## Project structure

```
src/
  app/
    page.tsx                 Copilot home
    assets/                  equipment list + asset profile (per-machine AI)
    knowledge/               indexed document library
    api/                     chat (streaming), upload, assets, knowledge
  components/                Sidebar, TopBar, Copilot, Composer, Markdown
  lib/
    ai/                      system prompt, Anthropic client, demo engine, chat
    rag/                     extract, chunk, ingest, retrieve
    db/                      Drizzle schema + self-initializing connection
    queries.ts              data access
```

## Platform layer (the moat)

EAS is built to be the **system of intelligence on top of** a plant's existing
stack — not a rip-and-replace. The platform layer makes that real:

- **Public API (`/api/v1`)** secured by API keys (`Authorization: Bearer eas_live_…`).
  Any CMMS/EAM/ERP/portal can embed EAS:
  - `POST /api/v1/ask` — the Copilot as an API (structured answer + sources)
  - `GET|POST /api/v1/work-orders`, `GET|POST /api/v1/assets`
- **Connector framework** (`src/lib/integrations/`) — a 15-connector catalog with
  a single `ConnectorAdapter` interface and per-connector sandbox mode:
  - **CMMS/EAM:** MaintainX, Fiix, Limble, UpKeep · **ERP:** SAP PM, IBM Maximo
  - **CRM:** Salesforce, HubSpot
  - **Sensors:** Tractian, SKF, MachineMetrics, Fluke
  - Connect → Sync pulls assets + work orders in; work orders push back out. Live
    credentials swap the sandbox adapter for a real one without touching callers.
- **Webhooks + event bus** — HMAC-signed delivery on `workorder.created`,
  `integration.synced`, `copilot.answered`, `asset.created`, and more.
- **Work Orders** — first-class records. The Copilot's diagnosis converts to a
  work order in one click, which then syncs to any connected CMMS.
- **Team Skills** — the technician skills matrix. Computes per-skill coverage
  and flags single-points-of-failure so managers can plan cross-training and
  safe work assignment. (Recruiting/ATS features are not part of this product.)
- **Live connectors** — the sandbox swaps to a real vendor adapter the moment a
  credential is present. **MaintainX is implemented live** today
  (`MAINTAINX_API_KEY`): real work-order push, asset/WO pull. Other connectors
  follow the same `ConnectorAdapter` contract.
- **Enterprise auth — RBAC + SSO** — five roles (owner/admin/manager/
  technician/viewer) with a permission matrix enforced server-side, scrypt
  password auth, sessions, and **OIDC SSO** (Okta/Auth0/Entra/Google/Ping).
  Off by default for a zero-friction demo; flip `AUTH_REQUIRED=true` to enforce
  sign-in across the app (middleware-gated) — see `.env.example`.
- **Multi-tenant + audit** — `orgId` on every row; append-only audit log; every
  domain action emits an auditable event.

## Roadmap (next)

Live connector credentials & OAuth flows · per-connector field mapping ·
vector/embedding retrieval · background job queue with retries/dead-letter ·
RBAC + SSO · sensor-alert → auto-triage → work order automation ·
parts-supplier and PLC/historian integrations.
