# Customer Onboarding Checklist — EAS Industrial Copilot

**Purpose:** take a new customer from signed contract to confident daily use,
with their tenant isolated and empty at the start, exactly as the architecture
intends. Work top to bottom; each phase gates the next. **⟨brackets⟩** are
deployment-specific values to fill in.

---

## Phase 0 — Pre-flight (before provisioning)

- [ ] Contract / order form and (where required) DPA signed.
- [ ] Named roles identified: **executive sponsor**, **maintenance lead** (becomes
      org owner), **IT/security contact**, **EAS onboarding owner**.
- [ ] Decisions captured: hosting region, SSO (yes/no + IdP), model keys
      (customer BYO vs. platform), object-storage provider, backup RPO/RTO.
- [ ] Security review status noted (questionnaire returned; see Procurement packet).

## Phase 1 — Provision an isolated production tenant

- [ ] Deploy with **`SEED_DEMO_ORG=false`** so the customer org starts **completely
      empty** (no demo data).
- [ ] Confirm the Demo Organization is **unreachable** from the customer session.
- [ ] Verify the workspace resolves to a real customer org id (not a reserved
      scope).

## Phase 2 — Harden the deployment posture

- [ ] **`AUTH_REQUIRED=true`** (enforce sign-in + RBAC).
- [ ] Service behind **TLS** with the customer's real domain; confirm HSTS present.
- [ ] Durable **`DATABASE_URL` + `DATABASE_AUTH_TOKEN`** (managed libSQL/Turso or
      Postgres) — **not** the local file DB.
- [ ] Durable **object storage** (`STORAGE_S3_*`) configured for uploaded files.
- [ ] Secrets set in the platform **secret store** (never committed).
- [ ] `LOG_LEVEL` set (`info`), uptime monitor pointed at **`/api/health`**.
- [ ] (Optional) `CSP_ENABLED=true` after validating against the build.
- [ ] Backups enabled and the **DR runbook** reviewed with the customer.

## Phase 3 — Configure AI providers

- [ ] Add chat (and, when available, embeddings) keys — customer's or the
      platform's.
- [ ] Verify **`/api/health`** reports `aiConfigured: true`.
- [ ] Sample question returns **live generation with citations + a confidence
      score** (not the fallback engine).

## Phase 4 — Identity & access

- [ ] If SSO: register the OIDC app at the IdP; callback
      **`⟨APP_BASE_URL⟩/api/auth/oidc/callback`**; set `OIDC_*` + default role.
- [ ] Register the plant maintenance lead as the **org owner**.
- [ ] Invite planners, reliability engineers, and technicians via the invitation
      flow with **appropriately scoped roles** (owner/admin/manager/technician/
      viewer).
- [ ] Confirm least-owner protection and that role changes revoke sessions as
      expected.

## Phase 5 — Ground the Copilot in the plant's reality

- [ ] Upload the plant's **equipment manuals, electrical drawings, PLC exports,
      alarm history**.
- [ ] Confirm documents are **indexed** (chunks/embeddings present) and appear
      under the relevant assets.
- [ ] Validate a plant-specific question returns answers grounded in **their**
      documents (on top of the shared OEM knowledge), with citations.

## Phase 6 — Load the asset & parts foundation

- [ ] Enter the **critical assets** with location hierarchy (site/area/line/cell),
      manufacturer/model/serial (nameplate identity), criticality, and status.
- [ ] Enter the **spare parts** the team actually stocks (with critical-spare
      flags) so the Copilot can recommend the right part during a diagnosis.
- [ ] Link parts to assets where known.

## Phase 7 — Daily-loop acceptance test (the go-live gate)

Walk one **real recent failure** end to end and verify each step:

- [ ] Report "a machine is down" → select/scan the asset.
- [ ] Diagnose with the Copilot → grounded answer with citations + confidence.
- [ ] Open a work order scoped to that asset; move it through
      **open → in progress → done** with a captured resolution.
- [ ] Confirm **true downtime** is computed and the repair is auto-captured as a
      retrievable **lesson** (Maintenance Memory) on the asset.
- [ ] Generate a **preventive-maintenance suggestion** from the closed corrective
      work; confirm it is grounded and requires human approval.
- [ ] Verify **audit entries** were recorded and **isolation** held throughout.

## Phase 8 — Operational guardrails & success review

- [ ] Backup-and-restore procedure **documented and rehearsed** (DR runbook).
- [ ] Uptime monitoring + alerting on `/api/health`; error-log destination
      configured (`route.unhandled_error`).
- [ ] Support and **escalation path** agreed; on-call contacts exchanged.
- [ ] **Success metrics baselined** — downtime and mean-time-to-repair — and a
      pilot success-review date scheduled to measure against them.

---

### Go-live sign-off

- [ ] All phases complete · [ ] Acceptance test passed · [ ] Customer IT sign-off
- [ ] Owner: ⟨name⟩ · Date: ⟨date⟩ · EAS onboarding owner: ⟨name⟩
