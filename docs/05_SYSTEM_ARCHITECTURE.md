# EAS Intelligence: System Architecture

**The Manufacturing Intelligence Platform**

This document details the technical infrastructure required to support the EAS Intelligence platform, ensuring it is modular, observable, fault-tolerant, and capable of scaling to 10,000 facilities.

---

## 1. Database Architecture

The data layer is designed for strict isolation, allowing the underlying storage engine to evolve without impacting application logic.

### Current State: libSQL/SQLite (The Edge Monolith)
To maximize development velocity and support single-node or edge deployments, the current architecture utilizes libSQL (SQLite) via Turso.
- **Schema Management:** Drizzle ORM defines the schema. Migrations are handled via idempotent, backward-safe column additions executed on application boot, ensuring zero data loss during upgrades.
- **Repository Isolation:** All database access is encapsulated within domain-specific repositories (e.g., `src/lib/assets/repository.ts`). Application code never executes SQL directly.

### Future State: PostgreSQL (Enterprise Scale)
As the platform scales to multi-facility enterprise deployments, the data layer will migrate to PostgreSQL.
- **Migration Path:** Because the repository pattern abstracts the SQL dialect, migrating to PostgreSQL requires only updating the Drizzle connection driver and running the existing test suite. No business logic or API routes will change.
- **Vector Storage:** pgvector will be introduced to handle high-dimensional semantic embeddings natively alongside relational data.
- **Graph Storage:** For complex traversal queries (The Industrial Knowledge Graph), an adjacent graph database (e.g., Neo4j) or recursive CTEs in PostgreSQL will be utilized, synchronized via the Event Architecture.

## 2. Service & Event Architecture

EAS Intelligence utilizes an Event-Driven Architecture to decouple domains and enable real-time reactivity.

### Event Bus
Every state mutation (e.g., `AssetCreated`, `WorkOrderClosed`, `AlarmTriggered`) publishes a strongly-typed domain event to an internal Event Bus.
- **Synchronous Handlers:** For immediate cross-domain updates (e.g., updating a digital twin's reliability metrics when a new alarm is recorded).
- **Asynchronous Workers:** For heavy, non-blocking tasks. When a `DocumentUploaded` event fires, a background worker (e.g., BullMQ backed by Redis) picks up the job to parse the PDF, chunk the text, and generate vector embeddings.

### Modular Boundaries
While currently deployed as a Next.js monolith, the codebase is strictly partitioned by domain (`/assets`, `/knowledge`, `/work-orders`). This allows specific high-load domains (like the AI reasoning engine or PLC parsing) to be extracted into independent microservices if compute demands dictate.

## 3. API Standards

EAS Intelligence is an API-first platform. The frontend UI is simply the first consumer of the public API.

- **RESTful Resource Design:** Endpoints follow strict REST conventions (`GET /api/v1/assets`, `POST /api/v1/work-orders`).
- **Standardized Payloads:** All responses follow a predictable envelope structure, returning structured `{ data, error, message }` objects with appropriate HTTP status codes.
- **Idempotency:** Mutating endpoints (POST/PATCH) support idempotency keys to safely handle network retries from mobile devices on the plant floor.
- **Rate Limiting & Pagination:** All list endpoints implement cursor-based pagination and IP/Tenant-based rate limiting to protect platform stability.

## 4. Security Model

Security is paramount when handling proprietary manufacturing data and controls logic.

### Authentication & Authorization
- **Multi-Tenancy:** Every database query is strictly scoped by `orgId`. Cross-tenant data leakage is cryptographically impossible at the repository level.
- **Role-Based Access Control (RBAC):** Permissions (e.g., `view_assets`, `manage_assets`, `delete_assets`) are defined in a central matrix. Every API route enforces these permissions via a `requirePermission()` middleware guard.
- **Audit Logging:** Every mutating action is attributed to a specific actor and timestamped. The `audit()` helper ensures a permanent, immutable record of who changed what and when.

### Network & Infrastructure Security
- **Encrypted Transit & Rest:** All data is encrypted in transit (TLS 1.3) and at rest (AES-256).
- **No Inbound Holes:** The platform connects to on-premise PLCs and historians via outbound-only secure tunnels (e.g., MQTT over TLS or secure edge gateways). We do not require IT to open inbound firewall ports.

## 5. Scalability Strategy

Designing for millions of assets and billions of records requires a multi-tiered scaling approach.

1. **Stateless Compute:** The Next.js application servers are entirely stateless. They can be scaled horizontally behind a load balancer infinitely.
2. **Read Replicas:** The database architecture supports read replicas. Read-heavy operations (like loading the equipment list) are routed to replicas, preserving the primary writer for mutations.
3. **Edge Caching:** Static assets, OEM manuals, and public documentation are cached at the CDN edge (Cloudflare/Vercel) to reduce origin load and improve mobile performance.
4. **Tenant Sharding:** For massive enterprise customers (e.g., a Fortune 500 manufacturer with 100 plants), the database can be sharded by `orgId`, physically isolating their data onto dedicated database clusters to guarantee performance and compliance.
