# Procurement Readiness Packet — EAS Industrial Copilot

**Purpose:** a single reference a buyer's procurement, IT-security, legal, and
vendor-risk teams can use to evaluate EAS Industrial Copilot. It maps the
platform to the questions those teams ask. **Answers describe the system as
implemented;** items pending third-party validation are marked **Roadmap /
pilot-phase** and are stated honestly rather than overclaimed.

Companion documents: **Security & Architecture Whitepaper**, **Disaster Recovery
Runbook**, **PostgreSQL Readiness Audit**, **Enterprise Readiness Audit**,
**Customer Onboarding Checklist**.

---

## 1. Product & deployment

| Item | Answer |
|---|---|
| What it does | AI maintenance Copilot + work-order/PM/parts system for manufacturing, grounded in the customer's own documents and day-one OEM knowledge. |
| Deployment models | Single-tenant isolated instance or multi-tenant SaaS; containerized (Docker standalone), runs on Manus, Fly, Render, Cloud Run, Kubernetes. |
| Data residency | Customer-selected hosting region for app, database, and object storage. |
| Availability model | Stateless app tier (horizontal scale, clean restart) + durable managed database + object storage. |
| Tenancy | Per-organization isolation; every row `orgId`-scoped; no shared default tenant; proven by an automated isolation test suite. |

## 2. Security questionnaire — quick answers (SIG/CAIQ-style)

| Control area | Status | Notes |
|---|---|---|
| Multi-tenant data isolation | ✅ Implemented | `orgId` on every row + query; non-routable default sentinel; test-proven |
| Authentication | ✅ Implemented | Server-side opaque sessions, expiry, revoke-on-privilege-change |
| Enterprise SSO (SAML/OIDC) | ✅ OIDC | Okta/Entra/Auth0/Google/Ping; multi-tenant domain mapping = Roadmap |
| RBAC / least privilege | ✅ Implemented | Central permission gate; 5 roles; last-owner protection |
| Encryption in transit | ✅ | TLS + HSTS |
| Encryption at rest | ✅ | Provider-side (managed DB + object store) |
| Secrets management | ✅ | Platform secret store; never in source (enforced by ignore rules) |
| Audit logging | ✅ Implemented | Append-only, per-tenant, actor-attributed |
| Input validation | ✅ Core write paths | Zod schemas; malformed input → 400, not a 500 |
| Secure error handling | ✅ Implemented | Uniform envelope; no stack/detail leakage; request-id correlation |
| Rate limiting / anti-abuse | ✅ Implemented | Auth (per-IP) + public API (per-key); shared-store for multi-node = Roadmap |
| Security headers (OWASP) | ✅ Implemented | HSTS, nosniff, frame-deny, referrer, permissions-policy, COOP |
| Logging / monitoring | ✅ Implemented | Structured JSON logs; `/api/health` readiness probe |
| Backups & DR | ✅ Procedure | Documented runbook + rehearsal cadence; provider PITR recommended |
| Accessibility (WCAG AA) | ✅ Baseline | Keyboard focus, skip link, landmarks, reduced motion |
| Vulnerability mgmt / dep scanning | ⏳ Roadmap | Pinned deps today; automated CI scanning to be added |
| SOC 2 Type II | ⏳ Roadmap | Architecture ready; examination is a pilot-phase activity |
| Independent penetration test | ⏳ Roadmap | To be scheduled with the customer during pilot |
| DPA / data-processing terms | ⏳ Contracting | Ready to execute; not self-certified |
| Uptime SLA | ⏳ Contracting | Health telemetry exists; SLA agreed per contract |

## 3. Data handling & privacy

- **Customer data stays in the customer's tenant.** No customer text, document,
  asset, or identifier is shared across tenants.
- **AI grounding** uses the tenant's own documents + a shared, tenant-agnostic OEM
  knowledge library; answers carry citations and confidence.
- **Cross-customer learning** (the "moat") is **OFF by default** and consent-gated.
  When enabled, only an anonymized OEM signal (make/model/fault-code + coarse
  outcome) is pooled — never customer identifiers, asset ids, plant, or free text.
  A tenant's contributions are deletable on request.
- **Right to deletion / export:** per-tenant scoping makes tenant data deletion and
  export well-bounded operations.

## 4. Subprocessors (customer-configurable)

The customer chooses and approves the providers; typical set:

| Function | Example providers | Notes |
|---|---|---|
| Hosting/compute | ⟨Manus / Fly / Render / GCP / AWS / on-prem⟩ | Region selectable |
| Database | ⟨Turso/libSQL, or PostgreSQL host⟩ | PITR recommended |
| Object storage | ⟨Cloudflare R2 / AWS S3 / Backblaze B2 / MinIO⟩ | Versioned |
| AI model provider | ⟨Anthropic / OpenAI-compatible gateway⟩ | BYO-key supported; fallback engine if none |
| Identity (SSO) | ⟨Okta / Entra / Auth0 / Google / Ping⟩ | Customer-owned IdP |

A current subprocessor list with data-processing purposes is provided at
contracting and maintained thereafter.

## 5. Availability, DR, and support

- **RPO/RTO:** default ≤24h / ≤4h (app) / ≤8h (full DB restore), tightened with
  managed PITR; see the DR runbook for the tested procedure and rehearsal cadence.
- **Health/observability:** `/api/health` (DB-checked) for uptime monitoring;
  structured logs with request-id correlation for support triage.
- **Support & escalation:** agreed per contract; onboarding exchanges on-call
  contacts and the escalation path.

## 6. Commercial & contracting readiness

- **Motion:** invoiced enterprise (per-plant platform fee + AI-usage tier) — see
  the Enterprise Readiness Audit for the pricing structure rationale. Self-serve
  billing/metering is **Roadmap** (not required for an invoiced pilot).
- **Recommended first engagement:** a **paid pilot with a named plant**, running a
  real failure through the daily loop, with security assurances (pen test, SOC 2,
  DPA, SLA) completed **in parallel** during the pilot.

## 7. Honest gap statement

The software provably isolates each customer's data, records an audit trail,
recovers cleanly, reports its own health, validates its inputs, fails safely, and
answers with citations and confidence. The remaining items a procurement/IT-
security organization will require — **independent pen test, SOC 2 Type II, signed
DPA and uptime SLA, automated dependency scanning, and a production database
posture review** — are **pilot-phase activities, not blockers to beginning**, and
the architecture is ready for each. We state this plainly rather than implying
certifications that do not yet exist.
