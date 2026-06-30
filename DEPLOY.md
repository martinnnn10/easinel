# Deploying EAS Industrial Copilot

Production deployment guide for **Manus**, Docker, and any Node/PaaS host. The
app is a Next.js 15 standalone server — one container, no sidecars required.

---

## TL;DR

```bash
# 1. Build
npm ci
npm run build

# 2. Run (reads configuration from the environment)
node .next/standalone/server.js     # serves on $PORT (default 3000)
```

Or with Docker:

```bash
docker build -t eas-copilot .
docker run -p 3000:3000 --env-file .env eas-copilot
```

Health probe: `GET /api/health` → `200` when the process **and** database are
healthy, `503` if the DB is unreachable.

---

## Deploying to Manus

1. **Upload / import the zip** (or point Manus at the repo).
2. **Set environment variables** (Manus → project settings → Environment). The
   app boots with zero config in demo mode, but for a real deployment set at
   minimum:

   | Variable | Why |
   |---|---|
   | `DATABASE_URL` | Durable database. Use a hosted libSQL/Turso URL (`libsql://<db>.turso.io`). Without it, data lives in an ephemeral file and is **lost on restart**. |
   | `DATABASE_AUTH_TOKEN` | Auth token for the Turso database. |
   | `ANTHROPIC_API_KEY` | Enables the live Copilot (else it runs in demo mode). |
   | `AUTH_REQUIRED=true` | Enforce sign-in + RBAC (recommended for anything multi-user). |
   | `APP_BASE_URL` | Public URL of the deployment (used for OIDC redirect URIs). |

3. **Deploy.** Manus builds the image from the `Dockerfile` and runs it. The
   container exposes port `3000` and ships a `HEALTHCHECK` that hits
   `/api/health`.

> The Dockerfile is **12-factor**: it bakes no secrets. All configuration comes
> from the runtime environment, so the same image is safe to promote across
> dev → staging → prod.

---

## Required vs. optional configuration

Everything is documented in [`.env.example`](./.env.example). Summary:

**Persistence (set these for production)**
- `DATABASE_URL`, `DATABASE_AUTH_TOKEN` — durable database (Turso/libSQL).
- `STORAGE_S3_*` — durable file storage (R2/S3/B2/MinIO) for uploaded originals.
  Without it, uploads use the local `./uploads` folder (ephemeral).

**Intelligence**
- `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) — the reasoning engine.

**Security & access**
- `AUTH_REQUIRED=true` — enforce authentication + role-based access.
- `OIDC_*` — enterprise SSO (Okta, Entra ID, Auth0, Google Workspace, Ping…).
- `CSP_ENABLED=true` — turn on the Content-Security-Policy (validate first).
- `RL_*` — tune rate limits (auth + public API) without code changes.

**Observability**
- `LOG_LEVEL` — `debug|info|warn|error` (structured JSON logs to stdout/stderr).
- `APP_VERSION` — reported by `/api/health`.

---

## Operational surface

| Concern | Where |
|---|---|
| Liveness / readiness | `GET /api/health` (DB-checked; unauthenticated; leaks no tenant data) |
| Security headers | Applied to **every** response via middleware (HSTS, nosniff, frame-DENY, Referrer-Policy, Permissions-Policy, COOP; opt-in CSP) |
| Brute-force protection | Rate limiting on all auth endpoints (per IP) and the public API (per key); RFC `429` + `Retry-After` + `X-RateLimit-*` |
| Request correlation | `x-request-id` echoed on hardened responses (honors an inbound id) |
| Audit trail | Append-only `audit_log` records who changed what, per tenant |
| Multi-tenant isolation | Every row carries `orgId`; every query is org-scoped (enforced by tests) |

---

## Scaling notes

- **Rate limiting** is per-instance and in-memory — correct for a single node.
  Behind multiple replicas, re-back `src/lib/security/rateLimit.ts` with a shared
  store (Redis/Upstash); the `checkRateLimit` contract stays the same.
- **Database** uses a single isolation layer per domain (work orders, assets,
  PMs, parts) so a move from libSQL to Postgres re-implements those modules only.
- **Retrieval** runs an in-memory hybrid (lexical + vector RRF) suited to MVP/SMB
  corpora; swap in an ANN index behind `src/lib/rag/retrieve.ts` for large tenants.

---

## Verifying a deployment

```bash
curl -fsS https://<your-host>/api/health | jq
# { "status": "ok", "checks": { "database": "ok" }, "version": "1.0.0", ... }
```

If `status` is `degraded`, the process is up but the database is unreachable —
check `DATABASE_URL` / `DATABASE_AUTH_TOKEN`.
