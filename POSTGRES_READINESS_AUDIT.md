# PostgreSQL Readiness Audit

**Scope:** Can EAS Industrial Copilot move from its current libSQL/SQLite store to
PostgreSQL (for multi-node scale, HA, and enterprise DBA operability) without an
application rewrite? **Audit date:** 2026-07-01. **Verdict:** **Yes — low-risk,
well-localized.** The dialect coupling lives in two files; the ~15 repository
modules are already portable. Estimated effort: **2–4 focused engineering days**
plus a data-migration pass and test-matrix work. No architectural change.

This is an audit only — no code was changed in this pass.

---

## 1. Where the database coupling actually lives

| Layer | Files | Portable? |
|---|---|---|
| **Schema definition** | `src/lib/db/schema.ts` (`drizzle-orm/sqlite-core`) | ❌ dialect-specific — must be rewritten in `pg-core` (mechanical 1:1) |
| **Connection + bootstrap** | `src/lib/db/index.ts` (`@libsql/client`, `drizzle-orm/libsql`, 38 raw `CREATE TABLE` DDL, `PRAGMA table_info` migrations) | ❌ libSQL-specific — swap driver + move to drizzle-kit migrations |
| **Build config** | `drizzle.config.ts` (`dialect: "sqlite"`) | ❌ one-line change to `postgresql` |
| **Repositories (assets, workorders, pm, parts, plc, rag, auth, …)** | ~15 modules under `src/lib/**` | ✅ use the dialect-neutral Drizzle query builder + a single shared `db` handle |

**Why this is the good case:** every repository imports one `db` handle and builds
queries with `select/insert/update/delete` + `and/eq/inArray/desc/isNull`. None of
them contain SQLite-only SQL. The "single isolation point per domain" design the
project committed to holds up: a Postgres swap re-implements **schema.ts** and
**index.ts**, not the business logic.

---

## 2. SQLite-specific constructs to replace (the actual work)

1. **Driver / dialect** — `@libsql/client` + `drizzle-orm/libsql` → `pg` (or
   `postgres`) + `drizzle-orm/node-postgres`. `drizzle-orm/sqlite-core` →
   `drizzle-orm/pg-core`.
2. **Column types** (in `schema.ts`):
   - `integer(..., { mode: "timestamp_ms" })` — **56 columns**. Currently epoch-ms
     integers. Target: native `timestamp with time zone` (recommended, cleaner) or
     `bigint` if you want to preserve exact ms integers with app-side `Date`
     conversion. **Decision required** (see §4).
   - `integer(..., { mode: "boolean" })` — **5 columns**. → native `boolean`.
   - `text`/`real` → `text`/`doublePrecision` (direct equivalents).
3. **Default expressions** — `DEFAULT (unixepoch() * 1000)` is SQLite-only
   (appears on ~40 timestamp columns). → Postgres `defaultNow()` (with `timestamp`
   columns) or `sql\`(extract(epoch from now())*1000)::bigint\`` (with `bigint`).
4. **Bootstrap strategy** — `src/lib/db/index.ts` currently issues **38 raw
   `CREATE TABLE`** statements and runs additive `PRAGMA table_info`-based column
   migrations on boot. Postgres has no `PRAGMA`. → Replace the boot-time DDL with
   **drizzle-kit generated migrations** (`drizzle-kit generate` → `migrate()` on
   deploy). This is the single largest chunk of the work and also an upgrade:
   real versioned migrations instead of imperative boot DDL.
5. **`onConflictDoNothing()`** (2 sites in `src/lib/knowledge/oem.ts`) — already
   dialect-neutral in Drizzle; compiles to `ON CONFLICT DO NOTHING` in Postgres.
   **No change needed.**

---

## 3. Already portable / no action

- **App-generated IDs** — every primary key is an application `text` UUID
  (`id("prefix")`). No `AUTOINCREMENT`, no `rowid` reliance. Nothing to migrate on
  identity.
- **Raw SQL snippets** — only two, both in `src/lib/assets/repository.ts`:
  `sql\`${assets.parentAssetId} is null\`` and a `lower(...) like ...` search
  predicate over `coalesce(...)`. `lower`, `coalesce`, `like`, and `is null` are
  all valid Postgres — portable as-is (but see the LIKE watch-item in §4).
- **No `ATTACH`, no query-path `PRAGMA`s** — the only `PRAGMA` is `table_info`
  inside the boot migration, which the drizzle-kit migration approach replaces.
- **Embeddings** are stored as JSON `text` (not a SQLite vector type), so they
  move unchanged. (pgvector is an optional *upgrade*, not a migration blocker.)
- **Tenant isolation** — every query is already `orgId`-scoped in the repository
  layer; unaffected by the engine swap.

---

## 4. Watch-items (get these right during the swap)

1. **⚠️ Optimistic-concurrency result field.** The work-order transition OCC check
   in `src/lib/workorders/repository.ts` reads `res.rowsAffected` from the update
   result. libSQL returns `rowsAffected`; **drizzle-pg (node-postgres) returns
   `rowCount`.** On a naive swap this check would read `undefined`, never equal 0,
   and **silently disable the concurrency guard.** Fix when swapping: read
   `rowCount` (or normalize both). This is the one place where a data-integrity
   guarantee depends on a driver-specific field — call it out in the migration PR.
2. **LIKE case-sensitivity.** SQLite `LIKE` is case-insensitive for ASCII by
   default; Postgres `LIKE` is case-**sensitive**. The asset search already wraps
   the column in `lower(...)`; ensure the bound parameter is also lowercased (or
   switch to `ILIKE`) so search behavior is identical. Low risk, easy to verify.
3. **Timestamp representation decision.** If you keep epoch-ms `bigint`, the
   repositories that do `new Date(row.col)` keep working unchanged; if you move to
   native `timestamptz`, Drizzle returns `Date` objects directly and a few
   `ms()`/`Number(...)` coercions can be simplified. Recommend **`timestamptz`**
   for DBA-friendliness; budget a small sweep of the `ms()` helpers.
4. **Boolean data conversion.** Existing `0/1` integer values must cast to real
   booleans during data migration (`sharedConsent`, `active`, `verified`,
   `criticalSpare`, invitation/webhook flags).
5. **Connection pooling.** libSQL is a single embedded/HTTP client; Postgres needs
   a pool (`pg.Pool`) sized to the deployment, and — behind a serverless runtime —
   a pooler (PgBouncer / Neon / Supabase pooler) to avoid connection exhaustion.
6. **Test matrix.** The 163-test suite runs against in-memory SQLite (fast,
   hermetic). Keep those for unit speed, and add a **Postgres integration lane**
   (a containerized PG in CI) that runs the repository/isolation suites against the
   real engine so dialect drift is caught. The OCC concurrency test is the highest-
   value one to run against Postgres.

---

## 5. Recommended migration plan

1. **Branch + dual schema.** Rewrite `schema.ts` in `pg-core` (types + defaults).
   Keep the SQLite version until parity is proven.
2. **Generate migrations.** `drizzle-kit generate` (dialect `postgresql`); replace
   the boot-time DDL in `index.ts` with a `migrate()` call; swap the client to a
   `pg.Pool`.
3. **Fix the watch-items** (§4) — OCC `rowCount`, LIKE lowercasing, `ms()` helpers.
4. **CI Postgres lane.** Add a container-Postgres test job; run tenancy +
   workorder (incl. concurrency) + rag suites against it.
5. **Data migration.** Export current tables; load into Postgres casting
   timestamps (ms→timestamptz) and integers→booleans. Verify row counts + a
   tenant-isolation spot check.
6. **Cutover.** Point `DATABASE_URL` at Postgres, run `migrate()`, verify
   `/api/health` reports `database: ok`, then run the daily-loop acceptance test.

---

## 6. Bottom line

Nothing about the application logic blocks Postgres. The coupling is confined to
**two files plus one config line**, the repositories are already written to a
dialect-neutral query builder, identities are app-generated, and the only
data-integrity dependency on a driver detail (the OCC `rowsAffected` field) is
identified above so it can't be missed. This is a **routine, well-bounded
migration** — appropriate to schedule against a multi-node scale requirement or a
customer DBA mandate, not a rewrite.
