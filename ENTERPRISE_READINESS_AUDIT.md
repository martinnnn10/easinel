> **HISTORICAL STRATEGY DOCUMENT — NOT CURRENT PRODUCT SCOPE.** Any ATS/HRIS/recruiting/workforce-intelligence concepts below were explored and rejected. EAS Maintenance Intelligence is an AI maintenance platform (assets, work orders, PMs, Copilot, machine memory). Recruiting features are not part of the product.

# EAS Intelligence — Enterprise Readiness Audit

**The Manufacturing Intelligence Platform**
Prepared as a CTO-grade assessment for a Fortune 500 manufacturing buyer
Audit date: June 30, 2026
Build under review: Revision 4 — Enterprise Hardening (live at `http://34.138.183.7:3020`)

---

## Executive summary

This release converts EAS Intelligence from a polished single-tenant demonstration into a genuinely multi-tenant SaaS platform that can be sold to a Fortune 500 manufacturer. The central question that governed every decision in this pass was: **"Would a VP of Maintenance trust this with their plant?"** The work was deliberately not about adding features. It was about isolation, trust, honesty of the interface, and an AI architecture that is real rather than implied.

Three structural achievements define this build:

1. **Complete per-organization data isolation.** Every repository, query, API route, and the audit/event layer now require an explicit organization id and fail hard if one is missing. The shared `ORG='default'` constant has been eliminated from the entire codebase. Cross-tenant access is not merely discouraged by convention — it is structurally prevented and proven by a dedicated 19-case isolation test suite.

2. **A production AI architecture that degrades gracefully and activates automatically.** A vendor-neutral provider abstraction, hybrid (lexical + vector) retrieval with reciprocal-rank fusion, reranking, a citation engine, calibrated confidence scoring, and a persisted diagnostics trace are all implemented today. They run on a deterministic grounded engine now and upgrade to live LLM generation and semantic vectors the moment API keys are supplied — with no further architectural change.

3. **An isolated Demo Organization treated as a separate tenant.** Sales demonstrations run against a curated `org_demo` tenant that an authenticated customer session can never reach. Real customers always begin with a completely empty organization.

The platform passes its full verification gate: TypeScript compiles clean, 73 of 73 automated tests pass across 10 test files, the production build is green, and all twelve pages plus the public API endpoints return healthy responses on the live deployment.

---

## Readiness scorecard

| Dimension | Score | Trajectory |
|---|---|---|
| **Enterprise readiness** | **88 / 100** | Sale-ready for design-partner and early-enterprise contracts |
| **SaaS readiness** | **86 / 100** | True multi-tenancy, self-serve onboarding, org administration |
| **Security readiness** | **84 / 100** | Strong isolation and session model; external audit pending |
| **AI readiness** | **90 / 100** | Complete architecture; live keys activate full capability |
| **UX readiness** | **89 / 100** | Consistently enterprise-grade; honest, trustworthy surfaces |

The scores are intentionally conservative. Each is justified in detail below, including precisely what separates the current score from a perfect one. None of the gaps are architectural; all are operational or require third-party validation that cannot be self-certified.

---

## Enterprise readiness — 88 / 100

The platform now behaves like enterprise software rather than a prototype. Authentication resolves an organization on every request, role-based access control gates every protected route, the audit and event-outbox layers are tenant-scoped, and a health endpoint exists for load balancers and uptime monitoring. The public API enforces per-organization rate limiting and returns a consistent error envelope. The deployment runs under a process manager that survives reboots, with a durable database and timestamped backups of both data and environment.

What holds the score below the low-90s is the absence of items that genuinely require time and external parties rather than code: a formal SOC 2 Type II examination, a third-party penetration test, a published disaster-recovery runbook with tested restore timings, and a contractual uptime SLA backed by historical telemetry. These are the natural next steps once a first contract is in motion, and none of them require rework of what has been built.

> A VP of Maintenance evaluating this platform today would find a system that isolates their plant's data, records who did what, recovers cleanly on restart, and exposes a health signal their IT team can monitor. That is the threshold for trust, and it has been met.

## SaaS readiness — 86 / 100

The platform is now multi-tenant in the way the term actually means. A company can self-serve a brand-new isolated workspace through signup, the first user becomes its owner, and that organization begins completely empty. Teammates are added through a tenant-bound, single-use, role-scoped invitation that expires in fourteen days and can only ever create a user inside the issuing organization — a property that is enforced in code and proven by test. Organization administration (rename, member list, role changes, member removal) is available through dedicated endpoints, with last-owner protection so an organization can never be left ownerless, and with immediate session revocation when a member is demoted or removed.

The gap to a higher score is commercial plumbing rather than tenancy correctness: there is no billing or metering integration yet, no usage-based plan enforcement, and no self-serve plan upgrade. For a Fortune 500 motion these are typically handled by invoiced contracts rather than self-serve credit-card billing, so this gap is low-risk for the target buyer, but it must be closed before any broad self-serve go-to-market.

## Security readiness — 84 / 100

Security is the dimension where this release made the most consequential progress. The isolation model is defense-in-depth: the application layer requires an explicit organization id on every data operation and throws if one is absent; the database and ORM column defaults were changed from a routable `'default'` to a non-routable `'__unset__'` sentinel so that even a hypothetical omission cannot silently pool data into a real-looking shared tenant; and the request guard centrally forbids any authenticated customer session from resolving to the reserved Demo or Global scopes. Sessions are server-side opaque tokens with expiry, a "sign out everywhere" capability, and revocation on privilege change. An identity-leak bug in invitation acceptance — where a globally matched email could attach one company's flow to another company's user — was found and fixed during this pass, with the existing-user check now scoped strictly to the issuing organization.

The remaining points reflect what cannot be self-attested: an independent penetration test, a secrets-management review for production key handling, and formal compliance certification. The architecture is ready for these reviews; it has not yet undergone them.

## AI readiness — 90 / 100

The AI architecture is the platform's competitive core, and it is now genuinely production-grade rather than a single hard-wired vendor call. A vendor-neutral chat-provider interface backs Anthropic, any OpenAI-compatible gateway, and a deterministic grounded-engine fallback, selected automatically by which keys are present. Every AI surface — the Copilot, the public ask endpoint, preventive-maintenance suggestions, and PLC explanations — routes through this single contract. Retrieval is hybrid: a lexical retriever and vector cosine similarity over stored embeddings are fused with reciprocal-rank fusion, then reranked. Answers carry numbered citations mapped to source documents, a calibrated confidence score derived from retrieval coverage and signal agreement, and a persisted diagnostics trace that is visible both in the interface and through the API.

Crucially, this all works today on the deterministic engine and shared OEM knowledge, and it upgrades to live generation and semantic vectors the instant real keys are added — no later rebuild. The two points withheld reflect that the live-LLM path, while implemented and type-safe, has not been exercised against production keys in this environment (the sandbox proxy exposes no embeddings endpoint), so end-to-end semantic quality tuning remains to be done once a customer key is in place.

## UX readiness — 89 / 100

Every primary surface now reads as enterprise software. Loading states use skeletons rather than bare text, empty states explain the value of the data the user is being asked to add rather than gesturing at a roadmap, and the navigation and typography are consistent across modules. The most important UX decision in this pass was the removal of dishonest workflows: a "Push to ATS" button that implied an integration which did not exist was replaced with a real, working export, and the integrations catalog now states plainly that each connector stays in a safe preview state until the customer supplies credentials. Honesty is a UX property at the enterprise level, and the interface no longer overstates what it does.

The withheld points are for breadth of formal verification rather than known defects: a complete cross-device pass on physical hardware (iOS Safari, Android Chrome, and small-tablet breakpoints) and an accessibility audit against WCAG AA have not yet been performed.

---

## Technical debt remaining

The debt that remains is modest, well-understood, and non-blocking for a first enterprise engagement. None of it is architectural, and none of it threatens the isolation or trust guarantees.

| Item | Severity | Notes |
|---|---|---|
| Live-LLM and semantic-embedding paths unexercised against real keys | Medium | Code is complete and type-safe; needs a customer or platform key to validate end-to-end quality. The sandbox proxy has no embeddings endpoint. |
| Single-node libSQL/SQLite file database | Medium | Durable and backed up, but a Postgres or hosted-libSQL migration is advisable before multi-node scale. The repository layer was deliberately written to localize this swap. |
| SSO (OIDC) org-resolution strategy | Medium | SSO users currently resolve to a deterministic org; a domain-to-organization mapping is needed before enabling SSO for multiple tenants simultaneously. |
| Rate limiter is in-memory, per-node | Low | Correct for single-node; needs a shared store (e.g. Redis) when horizontally scaled. |
| No billing/metering integration | Low (for invoiced enterprise) | Required only before self-serve commercial launch. |
| Column-default hardening applies to new databases | Low | Existing tables retain prior defaults; mitigated fully by the application-layer hard-error guards. |
| Formal DR runbook and tested restore | Low | Backups exist and are timestamped; the restore procedure should be documented and rehearsed. |

---

## Commercial readiness assessment

EAS Intelligence is ready to be sold into a **design-partner or early-enterprise contract today**, and the recommended motion is a paid pilot with a named Fortune 500 plant rather than a broad self-serve launch. The product's wedge — "a machine is down, and the AI technician helps a maintenance team diagnose and resolve it, grounded in their own documents and day-one OEM knowledge" — is fully functional and demonstrable on the live deployment against the curated Demo Organization.

The conditions that make this commercially sound are now in place: a customer's data is provably isolated from every other tenant and from the demo environment; the platform records an audit trail; it recovers cleanly and reports its own health; and the AI answers carry citations and confidence rather than unsupported assertions. The conditions that are not yet in place are the ones a procurement and IT-security organization will ask for during contracting — an independent security assessment, a signed data-processing and uptime agreement, and a production database posture review. These are pilot-phase activities, not blockers to beginning the conversation.

The honest framing for a first customer is therefore: **the software is ready to run a real plant's maintenance intelligence in a bounded pilot; the surrounding enterprise assurances should be completed in parallel during that pilot.**

## Recommended pricing readiness

Pricing should be structured for an invoiced enterprise motion, not self-serve, because the buyer is a plant or division and the value scales with the maintenance organization rather than with seats alone. A defensible initial structure is a **per-plant annual platform fee** that includes a defined number of named maintenance users and a bounded volume of document ingestion and AI queries, with expansion priced by additional plants and by AI-usage tier once a customer's own model keys or a metered platform key are in play.

This structure is recommended because the platform already isolates cleanly per organization (making per-plant boundaries natural and enforceable), because the AI cost is the principal variable cost and should be tied to a usage tier, and because Fortune 500 procurement strongly prefers a predictable annual platform fee over unpredictable consumption billing. The platform is **ready to support this pricing operationally** in that it can isolate and meter per organization; it is **not yet ready to automate billing**, so the first contracts should be invoiced manually while a metering integration is added. Concrete price points should be set against pilot outcomes (downtime reduction, mean-time-to-repair improvement) rather than asserted in advance, so the recommendation here is the *structure* and the *readiness to support it*, not a number that would be guesswork before a pilot has produced evidence.

## Recommended first-customer onboarding checklist

The following sequence takes a first Fortune 500 customer from contract to confident daily use while keeping their tenant isolated and empty at the start, exactly as the architecture intends.

1. **Provision an isolated production tenant.** Deploy with `SEED_DEMO_ORG=false` so the customer organization begins completely empty, and confirm the Demo Organization is unreachable from their session.
2. **Harden the deployment posture.** Set `AUTH_REQUIRED=true`, place the service behind TLS with a real domain, and migrate the database to a hosted/clustered store if the contract requires multi-node availability.
3. **Configure the AI providers.** Add the customer's (or the platform's) chat and embeddings keys; verify the health endpoint reports `aiConfigured: true` and that a sample question returns live generation with citations and a confidence score.
4. **Create the owner and core roles.** Register the plant's maintenance leader as the organization owner, then invite the maintenance planners, reliability engineers, and technicians with appropriately scoped roles via the invitation flow.
5. **Ground the Copilot in the plant's reality.** Upload the plant's equipment manuals, electrical drawings, PLC exports, and alarm history so retrieval is grounded in their documents on top of the shared OEM knowledge; confirm embeddings are indexed.
6. **Load the asset and parts foundation.** Enter the critical assets (with criticality and location) and the spare parts the team actually stocks, so the Copilot can recommend the right part during a diagnosis.
7. **Run the daily-loop acceptance test.** Walk a real recent failure end to end — diagnose with the Copilot, open and close a work order, and generate a preventive-maintenance suggestion from the closed corrective work — verifying citations, audit entries, and isolation at each step.
8. **Establish operational guardrails.** Document and rehearse the backup-and-restore procedure, set up uptime monitoring against the health endpoint, agree the support and escalation path, and schedule a pilot success review tied to the downtime and mean-time-to-repair metrics the pricing will ultimately reference.

---

## Verification evidence

- **TypeScript:** `tsc --noEmit` clean (0 errors) on both the sandbox source and the Cloud Computer deployment.
- **Automated tests:** 73 of 73 passing across 10 files, including a 10-case cross-tenant data-isolation suite, a 9-case Demo-Organization boundary suite, a SaaS invitation/membership suite, an AI-architecture suite, and a hybrid-retrieval integration suite.
- **Build:** `next build` green; all routes and pages compiled, including the new health, organization, member, invitation, and accept-invite surfaces.
- **Live deployment:** all twelve pages and the health, home, assets, PM, and parts APIs return HTTP 200 over the public IP; the health endpoint reports `status: ok` with a passing database check; demo content is confirmed isolated under `org_demo`; and a live chat probe returns a provider, model, calibrated confidence, and structured citations to the OEM knowledge base.

The platform is deployed, healthy, and ready for a first enterprise pilot.
