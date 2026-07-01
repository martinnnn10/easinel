# Security & Architecture Whitepaper — EAS Industrial Copilot

**Purpose:** give a customer's security, IT, and architecture reviewers an
accurate picture of how the platform is built and how it protects their data.
Written to be shared under NDA during evaluation. Statements describe the system
as implemented; items still pending third-party validation are marked **Roadmap**.

---

## 1. What the product is

An AI operating system for manufacturing maintenance: a technician-facing Copilot
that diagnoses equipment faults grounded in the plant's own manuals, drawings,
PLC exports, and repair history — plus a work-order lifecycle, preventive-
maintenance program, and parts intelligence. It is a multi-tenant SaaS; each
customer organization is an isolated tenant.

## 2. Architecture at a glance

- **Web/app tier:** a single Next.js (App Router) service, deployed as a
  self-contained standalone server (Docker image; runs on Manus, Fly, Render,
  Cloud Run, Kubernetes, etc.). Stateless — all state is in the database/object
  store, so it scales horizontally and restarts cleanly.
- **Data tier:** libSQL/SQLite today (durable, portable), with a documented,
  low-risk path to PostgreSQL for multi-node scale (see the PostgreSQL Readiness
  Audit). Object storage (S3-compatible: R2/S3/B2/MinIO) for uploaded originals.
- **AI tier:** a vendor-neutral provider abstraction (Anthropic Claude, any
  OpenAI-compatible gateway, or a deterministic grounded fallback), plus a hybrid
  retrieval pipeline (lexical + vector fusion → rerank → cited answer).
- **Edge:** middleware applies security headers and an auth gate on every request.

## 3. Multi-tenant isolation (the core guarantee)

- **Every row carries an `orgId`;** every repository query is scoped by it. There
  is **no shared "default" tenant** — the column default is a non-routable
  sentinel (`__unset__`) so a row inserted without an explicit org can never
  silently pool into a real customer's data.
- **Isolation is enforced in code and proven by tests** — a dedicated cross-tenant
  isolation suite plus a demo-tenant boundary suite assert that one org can never
  read another's data, and that authenticated customer sessions can never resolve
  to the reserved Demo or Global (OEM-knowledge) scopes.
- **Reserved scopes** (`org_demo`, `__global__`) are read-only/system and
  unreachable from a customer session by construction (central request guard).

## 4. Authentication & authorization

- **Sessions:** server-side opaque tokens with expiry, delivered as an HTTP-only
  cookie; "sign out everywhere" and **revocation on privilege change** are
  supported. No credentials or roles are trusted from the client.
- **Enterprise SSO:** OIDC (Okta, Microsoft Entra ID, Auth0, Google Workspace,
  Ping, …). **Roadmap:** domain-to-organization mapping for multi-tenant SSO at
  scale.
- **RBAC:** every protected route calls a central permission gate; roles
  (owner/admin/manager/technician/viewer) map to explicit permissions. Last-owner
  protection prevents an org from being left ownerless.
- **Onboarding:** tenant-bound, single-use, role-scoped, 14-day-expiry invitations
  that can only ever create a user inside the issuing org (identity-leak-safe).
- **Public API:** bearer API keys, hashed at rest (prefix shown in UI), per-key
  rate limited, revocable.

## 5. API security posture

- **OWASP security headers on every response** (middleware): HSTS, `X-Content-
  Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-
  Policy (camera self for the scanner; mic/geo off), COOP; optional CSP.
- **Rate limiting:** brute-force protection on all auth endpoints (per IP) and
  per-tenant throttling on the public API; RFC-style 429 + `Retry-After` +
  `X-RateLimit-*`. In-memory per node today; **Roadmap:** shared store (Redis)
  for multi-node.
- **Input validation:** untrusted request bodies are validated (Zod) on the core
  write endpoints — malformed input is rejected with a clear 400 rather than
  reaching the data layer.
- **Uniform error handling:** every route is wrapped so an unhandled exception
  becomes a structured server log **and** a clean `{error, message, requestId}`
  envelope — **no stack traces or internal details are leaked** to callers.
- **Request correlation:** an `x-request-id` (honoring an inbound id) ties a
  client-visible error to the exact server log line.

## 6. Data protection

- **In transit:** TLS terminated at the platform/ingress; HSTS instructs browsers
  to stay on HTTPS.
- **At rest:** provided by the managed database and object store (provider-side
  encryption); secrets live in the deploy platform's secret manager, **never in
  git** (enforced via `.gitignore`/`.dockerignore` covering all `.env*`).
- **Audit trail:** an append-only, per-tenant `audit_log` records who did what
  (actor-attributed) across sensitive mutations (auth, role changes, work-order
  lifecycle, PM approval, etc.).
- **Tenant data deletion:** the moat/pooling boundary (below) retains an
  `originOrgId` solely so a tenant's contributions can be deleted on request.

## 7. AI data handling & the cross-customer "moat" boundary

- **Grounding, not guessing:** answers are retrieved from the tenant's own
  documents plus a shared, tenant-agnostic OEM knowledge library, and carry
  numbered **citations** and a calibrated **confidence** score. A persisted
  diagnostics trace records what was retrieved.
- **Tenant text never leaves the tenant.** The only cross-customer signal is a
  deliberately narrow, anonymized OEM failure record (make/model/fault-code +
  coarse outcome) — **no customer identifier, asset id, plant, or free text.**
- **Pooling is OFF by default** and gated behind explicit consent
  (`CROSS_CUSTOMER_LEARNING`); the schema separates poolable OEM-level signal from
  private process data so the boundary is structural, not a policy promise.
- **Provider flexibility:** customers can supply their own model keys; the AI tier
  degrades to a deterministic grounded engine if no key is present.

## 8. Secure development & operations

- **SDLC:** typed codebase (TypeScript, `tsc --noEmit` clean), an automated test
  suite (unit + tenant-isolation + retrieval + concurrency), and a green
  production build gate on every change, enforced in **CI on every push/PR**
  (typecheck → test → build). Tests are hermetic (in-memory DB, no external
  calls).
- **Observability:** structured JSON logs (level-gated), a health/readiness probe
  (`/api/health`, DB-checked, leaks no tenant data) for load balancers and uptime
  monitoring.
- **Data integrity:** the work-order state machine uses optimistic concurrency
  control and idempotent transitions so concurrent actions can't double-close or
  double-count.
- **Dependency posture:** dependencies are pinned via lockfile; CI runs
  `npm audit` on every push/PR (advisory today). **Roadmap:** hard-fail the
  pipeline on new high/critical advisories once the tree is clean.

## 9. Compliance posture

**Implemented today:** tenant isolation, RBAC, audit logging, encryption in
transit/at rest (provider), secret hygiene, secure error handling, and an
accessibility baseline (WCAG AA: keyboard focus, skip link, landmarks, reduced
motion).

**Roadmap (require time / third parties — cannot be self-certified):** SOC 2
Type II examination, independent penetration test, formal secrets-management
review, a signed DPA, and a contractual uptime SLA backed by telemetry. The
architecture is ready for these reviews; they are pilot-phase activities.

## 10. Shared-responsibility summary

| Area | EAS platform | Customer |
|---|---|---|
| App/data isolation, RBAC, audit, secure errors | ✅ | — |
| TLS, secret storage, DB/object encryption | ✅ (configure) | Provide/approve providers |
| Identity provider (SSO) | Integrate (OIDC) | Own the IdP, user lifecycle |
| Model keys / AI spend | Support BYO-key | Provide keys / approve provider |
| Backups & DR | Procedure (runbook) | Approve RPO/RTO, provider choice |
| User/role administration | Provide tools | Operate (assign roles, offboard) |
