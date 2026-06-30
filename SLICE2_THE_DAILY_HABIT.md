# Slice 2 — The Daily Habit

**Status:** Complete, pending review.
**Wedge:** "A machine is down." Everything in this slice serves the technician at the moment of a breakdown and the loop that follows.
**Build discipline:** Additive-only. Slice 1 (Asset Intelligence / Digital Twin) is untouched and still passes. Legacy work-order callers continue to work through a thin back-compat shim.

---

## 1. What this slice delivers

Slice 1 built the *container* (the digital twin of an asset). Slice 2 builds the *daily-use loop* that fills that container with data and gives a technician a reason to open the product every shift:

1. **The work order is now a real lifecycle**, not a status string. A breakdown is reported, worked, optionally put on hold, and closed with a captured resolution. Every transition is recorded, downtime is computed from real timestamps, and closing a corrective work order emits an anonymized OEM-level failure signal (the moat).
2. **A mobile-first troubleshooting experience** — the screen a technician actually uses standing in front of a stopped machine: a triage board, a one-tap "A machine is down" entry, and a work-order detail page with lifecycle buttons, an event-history timeline, and an asset-scoped Copilot seeded with the symptom.
3. **Pre-seeded OEM knowledge** so a brand-new, empty account gets grounded, cited answers on day one — before the customer has uploaded a single manual.

Each maps to a decision locked with the founder:

| Decision | How Slice 2 honors it |
|---|---|
| **D1 — AI-native Maintenance OS** (system of record for the daily loop) | Work orders are owned here, with full lifecycle + history; CMMS push is preserved for customers who already run SAP/Maximo/MaintainX. |
| **D2 — Wedge: "a machine is down"** | The entire UX funnels to: what's down → asset → work order → grounded help. |
| **D3 — Moat: cross-customer learning** | `oem_failure_signals` separates poolable OEM-level signal from tenant-private text; pooling stays OFF until consent. |
| **D4 — Time-to-value: pre-seeded knowledge** | 5 org-global OEM references, retrievable on day one, self-healing seed. |

---

## 2. Data layer (migration)

All changes are **additive** and safe on an existing database (idempotent `ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). No data loss, no destructive migration.

### 2.1 Work order lifecycle fields (added to `work_orders`)
`symptom`, `resolution`, `reported_at`, `started_at`, `closed_at`, `downtime_mins`. These let us compute **true downtime** (reported → closed) rather than guessing, and capture the symptom→resolution pair that powers both maintenance memory and the moat.

### 2.2 `work_order_events` (new, append-only history)
Every meaningful change — creation, status transition, assignment, note — is written as an immutable row (`kind`, `from_status`, `to_status`, `note`, `actor`, `created_at`). This is the audit trail *and* the timeline the UI renders. Indexed by `(org_id, work_order_id)`.

### 2.3 `oem_failure_signals` (new, the moat boundary)
The single, deliberate place where data crosses the tenant boundary — and it is built so that crossing is *safe by construction*:

- **Carries only:** `manufacturer`, `model`, `asset_type`, `fault_code`, a coarse `resolution_category` (e.g. `cooling` / `mechanical` / `electrical` / `controls` / `other`), `downtime_mins`, `labor_mins`.
- **Never carries:** asset id, plant, customer name, or any free text.
- **`shared_consent`** defaults to `false`. The row is written on every qualifying close regardless, so turning the moat *on* later is a **query change, not a migration**. Pooling reads `WHERE shared_consent = 1`.
- **`origin_org_id`** is retained **only** so a tenant's signals can be deleted on offboarding — never used in pooled queries.

This is the architectural answer to the red-team critique: single-tenant data lock-in is a *switching cost*, not a moat. The only compounding moat is privacy-preserving, OEM-level cross-customer learning — and it is far cheaper to structure the schema for it now than to retrofit it later. We structured it now; we did not turn it on.

---

## 3. The work order repository + state machine

`src/lib/workorders/repository.ts` is the **single isolation layer** for the daily loop (mirroring the Slice 1 asset repository). Only this file and the DDL know SQL, so a future PostgreSQL migration touches nothing else.

### 3.1 State machine
```
open ──▶ in_progress ──▶ done
  ▲          │   ▲          │
  │          ▼   │          │ (reopen)
  └──────  on_hold          ▼
                         (open)
synced  ◀── (CMMS push, terminal/legacy)
```
- `canTransition(from, to)` is the single source of truth. Illegal moves are rejected at the API with **HTTP 409** — the UI can only ever offer legal next states.
- `in_progress` stamps `started_at`; `done` stamps `closed_at` and computes `downtime_mins = closed_at − reported_at`; reopening clears the close stamps so the next close recomputes cleanly.
- `synced` (push to an external CMMS) is preserved as a terminal state for the integration flow.

### 3.2 What close does (the loop's payoff)
On close of a **corrective** work order, the repository computes true downtime, records the resolution, writes the history event, emits the `workorder.updated` event, writes the RBAC-attributed audit entry, **and** emits the anonymized OEM failure signal — wrapped so signal emission can never block or fail the technician's close action.

### 3.3 KPIs
`workOrderStats()` returns open / in-progress / on-hold / done counts and **mean true downtime of closed corrective WOs** — the headline reliability number, computed from real lifecycle timestamps, surfaced on the triage board.

---

## 4. Pre-seeded OEM knowledge (day-one value)

`src/lib/knowledge/oem.ts` ships a curated library of **generic, vendor-class** fault references for the most common North American plant equipment: Allen-Bradley PowerFlex 525 VFD faults, centrifugal pumps, gear reducers, AC motors, and a brand-agnostic VFD diagnostic approach. They are seeded as **org-global documents** (`asset_id = null`) through the normal document→chunk→retrieval pipeline, so:

- A brand-new account can ask *"PowerFlex 525 F081"* or *"pump cavitation"* and get a grounded, cited answer **with zero uploads**.
- When the customer later uploads their **own** manual for a specific asset, the asset-affinity boost makes their document out-rank the generic reference automatically. Generic knowledge fills gaps; it never masquerades as the customer's machine.

**Honesty (Constitution):** this content is labeled `oem_reference` and surfaced *as* a general reference, is intentionally conservative, and always points to the OEM manual + LOTO for anything safety-critical. It never instructs anyone to bypass a safety device.

### 4.1 A real bug caught and fixed during this slice
While writing the tests I found that **only 1 of the 5 OEM references was actually seeding** in a full bootstrap. The original seed used a single "first-document" idempotency guard: if reference #1 existed, it skipped the whole library — so a bootstrap that inserted #1 and was then interrupted (or re-entered) left references #2–#5 **permanently unseeded**. In production that would mean four-fifths of the promised day-one knowledge silently never existed.

**Fix:** seeding is now **per-document idempotent and self-healing** — each reference is checked and inserted independently, so any missing reference is restored on the next call and existing ones are left untouched. Verified end-to-end against the full production bootstrap: all five references are retrievable on day one, and customer docs still out-rank them. This is exactly the kind of silent gap the "verify after implementing" and "brutal honesty" principles exist to catch.

---

## 5. API surface

| Method & route | Purpose | RBAC |
|---|---|---|
| `GET /api/work-orders` | List with rich filters (status, priority, asset, type, search) + optional `?stats=1` KPI summary | view |
| `POST /api/work-orders` | Create (accepts `title` or `symptom`) | `manage_work_orders` |
| `GET /api/work-orders/[id]` | Detail **with full history timeline** | view |
| `PATCH /api/work-orders/[id]` | Field edit **or** lifecycle transition (409 on illegal transition) | `manage_work_orders` / `close_work_orders` |
| `DELETE /api/work-orders/[id]` | Remove | `manage_work_orders` |
| `POST /api/work-orders/[id]` | CMMS push (preserved `markSynced`) | `manage_work_orders` |
| `GET/POST /api/v1/work-orders` | Public API-key surface — **backward compatible** | API key |

Retrieval (`src/lib/rag/retrieve.ts`) was extended so org-global OEM references are always eligible, with a slight de-emphasis vs. asset-specific documents and a `×1.5` boost for the asset's own docs.

---

## 6. Mobile-first troubleshooting UX

Designed for one hand on a ~6-inch screen in a noisy plant.

- **`/work-orders` — triage board:** KPI strip (open / in-progress / on-hold / mean downtime), status filter chips, priority rail, debounced search, large touch targets, and a prominent **"A machine is down"** create entry. Full **loading skeletons, empty state, and error state**.
- **`/work-orders/[id]` — the breakdown screen:** lifecycle stage as one-tap buttons (only legal transitions shown), a **close-out flow that captures the resolution** (feeding downtime + the OEM signal), the **event-history timeline**, an asset link back to the digital twin, and an **asset-scoped Copilot tab seeded with the symptom** so the technician can ask for help in context. Loading/empty/error states throughout; responsive layout verified.

---

## 7. Global standards checklist

| Standard | Status |
|---|---|
| Database migration | Additive DDL + idempotent column migrations; no data loss |
| Backend API | Repository-backed routes + preserved `/api/v1` |
| Frontend UI | Triage board + breakdown detail, mobile-first |
| Tests | 27 passing (work-order state machine, lifecycle/downtime, history, moat anonymization + consent gating, OEM day-one retrieval, plus Slice 1) |
| Documentation | This file |
| RBAC | `manage_work_orders` / `close_work_orders` enforced on every mutating route; org-aware; open-review mode via config only |
| Audit logging | Every create/update/transition/delete writes an attributed audit entry |
| Loading states | Skeletons on both pages |
| Empty states | Both pages |
| Error handling | Both pages + 409 on illegal transitions |
| Mobile responsiveness | Designed mobile-first, verified |
| Performance review | In-memory keyword scan is adequate at MVP data sizes; retrieval and stats are indexed; ANN/vector swap is isolated behind the retriever; KPI query is a single indexed aggregate |

---

## 8. Future PostgreSQL path (unchanged stance)

Per Decision: stay on libSQL/Turso for now, but keep the swap straightforward. All Slice 2 data access is funneled through `workorders/repository.ts`; the DDL is the only other SQL site. A PostgreSQL migration is therefore a two-file change (driver + DDL dialect), not an application rewrite.

---

## 9. What I deliberately did **not** build

- **No AI actuation** — the Copilot advises; the human acts. No writing to PLCs, no self-healing control loops. This is a safety/liability line, not a roadmap gap.
- **No cross-customer pooling turned on** — the schema is ready; the feature waits for customer consent and enough customers to matter.
- **No new personas** — strictly the maintenance technician's breakdown loop, per the wedge.
