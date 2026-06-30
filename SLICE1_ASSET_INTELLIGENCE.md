# Slice 1 — Asset Intelligence (Digital Twin)

**EAS Intelligence — The Manufacturing Intelligence Platform**

This slice turns a thin asset record into a **digital twin**: a single screen that
rolls up everything known about a machine — nameplate, location, lifecycle status,
photos, documents, PLC programs, work orders, alarm/fault history, troubleshooting
sessions, and **computed reliability metrics** — and feeds all of it to the Copilot
as grounded context.

Every part of the slice meets the platform's global standards: a backward-safe DB
migration, backend API, frontend UI, tests, documentation, RBAC, audit logging,
and loading / empty / error states with mobile-responsive layouts.

---

## 1. Schema changes & migration strategy

### New / expanded tables (`src/lib/db/schema.ts`)

| Table | Purpose |
| --- | --- |
| `assets` (expanded) | Adds `site`, `area`, `line`, `cell`, `manufacturer`, `model`, `serial_number`, `asset_type`, `status`, `criticality`, `installed_at`, `image_path`, `updated_at` to the original thin record. |
| `asset_photos` (new) | Photo gallery per asset (nameplate, install, fault shots). |
| `alarm_events` (new) | Alarm / fault history feeding reliability metrics. Source-agnostic (`manual`, `alarm_log`, `historian`, or a connector key). |

New indexes: `idx_assets_org`, `idx_asset_photos_asset`, `idx_alarm_events_asset`.

### Backward-safe migration

`src/lib/db/index.ts` runs **idempotent column migrations** (`runColumnMigrations`)
on every boot. New columns are added to an existing `assets` table with
`ALTER TABLE … ADD COLUMN` guarded by a "does this column already exist?" check, so
**existing databases upgrade in place with zero data loss** and fresh databases get
the full DDL. The new tables are created with `CREATE TABLE IF NOT EXISTS`.

This is the only place that knows about the physical schema; nothing else issues DDL.

---

## 2. Repository pattern & the Postgres migration path

`src/lib/assets/repository.ts` is the **single isolation point** for all asset data
access. Application code (API routes, the Copilot, the UI) depends only on the
functions this module exports — never on Drizzle or SQL directly for assets.

Exported surface:

- `listAssets(orgId, filters?)` — filter by site / area / line / status / criticality / assetType / free-text search.
- `getAsset(orgId, id)`
- `createAsset(orgId, input, actor)` / `updateAsset(...)` / `deleteAsset(...)`
- `addAssetPhoto(...)` / `listAssetPhotos(...)`
- `addAlarmEvent(...)` / `listAlarmEvents(...)`
- `getAssetDigitalTwin(orgId, id)` — the full aggregation (see §4).
- `buildAssetContext(orgId, id)` — the rich AI context string.

**Why this matters for Postgres:** when we move off libSQL/Turso, only this file
(plus the DDL in `db/index.ts`) is rewritten against the new driver. Every caller,
every test assertion, and the entire UI are untouched because they speak the
repository's TypeScript contract, not SQL dialect. The repository test suite
(`repository.test.ts`) runs against an in-memory libSQL DB today and would be
re-pointed at a Postgres test instance to validate the swap.

All mutations are **org-scoped** (multi-tenant ready), **actor-attributed** via the
`audit()` helper, and emit a **domain event** (`asset.created/updated/deleted/photo_added`)
through `emitEvent()` for webhook fan-out.

---

## 3. Embedding provider interface

`src/lib/embeddings/index.ts` defines a vendor-neutral `EmbeddingProvider`
interface plus `getEmbeddingProvider()` factory:

- **OpenAI-compatible provider** when `OPENAI_API_KEY` is set (real semantic vectors).
- **Keyword fallback** (deterministic hashing bag-of-words, L2-normalized) when no
  key is present or `EMBEDDINGS_DISABLED=1` — so the product is fully functional
  offline / in demo mode.
- Every vector carries `{ provider, model, version, dim }` (`EmbeddingMeta`) so a
  future re-indexing job can detect and upgrade vectors produced by an older model.

Heavy semantic-search usage lands in Slice 2 (Knowledge Engine); this scaffold ships
now so the contract is stable. Covered by `embeddings.test.ts`.

---

## 4. Digital-twin aggregation logic

`getAssetDigitalTwin()` issues parallel reads and assembles:

```
asset + photos + documents + lessons (kind=lesson split out)
      + plcProjects + workOrders + alarmEvents + sessions + metrics
```

### Computed reliability metrics (`ReliabilityMetrics`)

- **failureCount** — fault/critical alarms + corrective work orders.
- **avgMTTRMins** — mean of corrective work orders' estimated labor minutes.
- **recurringFaults** — fault codes (or messages) seen ≥ 2×, most frequent first.
- **openWorkOrders / totalWorkOrders**.
- **daysSinceLastFault**.
- **suggestedPMIntervalDays** — heuristic: half the mean-time-between-failures, so
  preventive maintenance lands before the next expected fault (min 7 days).

These metrics drive the decision-support tiles on the twin page and are folded into
`buildAssetContext()` so the Copilot reasons over real reliability history.

---

## 5. API endpoints

All first-party routes enforce RBAC via `requirePermission()` and return structured
`{ error, message }` payloads with proper status codes.

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/assets` | `view` | List assets with filters (`site,area,line,status,criticality,assetType,search`). |
| POST | `/api/assets` | `manage_assets` | Create asset (technician+). |
| GET | `/api/assets/[id]` | `view` | Full digital twin. |
| PATCH | `/api/assets/[id]` | `manage_assets` | Update asset. |
| DELETE | `/api/assets/[id]` | `delete_assets` | Delete asset (admin+). |
| GET | `/api/assets/[id]/photos` | `view` | List photos. |
| POST | `/api/assets/[id]/photos` | `manage_assets` | Multipart photo upload (≤ 15 MB, image types). |
| GET | `/api/assets/[id]/photos/[photoId]` | `view` | Stream a stored photo. |
| GET | `/api/assets/[id]/alarms` | `view` | List alarm history. |
| POST | `/api/assets/[id]/alarms` | `manage_assets` | Record an alarm/fault. |

### RBAC additions (`src/lib/auth/roles.ts`)

- `manage_assets` → owner, admin, manager, technician.
- `delete_assets` → owner, admin.

Open review mode (`AUTH_REQUIRED` unset) resolves a synthetic owner so the product
runs friction-free while all RBAC checks still evaluate correctly.

---

## 6. Frontend

- **`/assets`** — equipment list with filter bar (status / criticality / type),
  debounced search, status + criticality badges, location, manufacturer/model,
  loading skeletons, empty state, error+retry, and a rich "New asset" modal.
- **`/assets/[id]`** — digital-twin page: header (name, tag, status, criticality,
  nameplate, location, installed date), primary photo + thumbnail strip with upload,
  four reliability metric tiles, a recurring-fault / suggested-PM callout, and tabs:
  Overview · Documents (PLC rows link to the Explorer) · PLC · Work Orders · Alarms
  (with inline "record alarm") · Sessions · Ask AI (asset-scoped Copilot). Every tab
  has its own empty state; the page handles loading / not-found / error. Layout is
  mobile-responsive (stacked header, horizontally scrollable tabs).

---

## 7. Seed data (`src/lib/seed.ts`)

- **Conveyor 3** enriched with the full nameplate/location field set (Plant A /
  Packaging / Line 2 / Takeaway, Allen-Bradley PowerFlex 525, S/N 1P5C25A103, drive,
  installed 2019-01-15, high criticality).
- **Two more assets** — Pump 12 (degraded) and Conveyor 1 (operational) — so the
  list reflects a real floor.
- **Alarm history** — 4 events on Conveyor 3 (two recurring F007 faults + F081/F012
  warnings) and a seal-weep note on Pump 12, so reliability metrics are populated on
  first load.

---

## 8. Tests

`npm test` (Vitest):

- `embeddings.test.ts` — factory toggle (key present / absent / disabled), fallback
  determinism + L2 normalization, semantic-similarity ordering.
- `repository.test.ts` — rich CRUD, filter + search, invalid-enum guarding, alarm +
  metric computation (recurring faults, days-since-fault, suggested PM), photo →
  primary-image behavior, AI context string, delete cascade. Runs against an
  in-memory libSQL DB so it exercises the real SQL path.

---

## 9. What's intentionally deferred

- Semantic search over embeddings → **Slice 2 (Knowledge Engine + PLC importers)**,
  which is also where the two approved merges from the uploaded zip land (upload
  notice banner in `Composer.tsx`, binary string-recovery helpers in `extract.ts`).
- The durable Cloud Computer host (`http://34.138.183.7:3020`) is **untouched** per
  instruction; Slice 1 is verified on the sandbox build and a fresh temporary URL.
