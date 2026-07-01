# Disaster Recovery Runbook — EAS Industrial Copilot

**Audience:** Platform operators / on-call. **Purpose:** restore service and data
after a failure, with defined objectives and a rehearsed procedure. Keep this
document versioned with the deployment and review it after every drill.

> This runbook describes procedures against the reference architecture (Next.js
> standalone container + libSQL/Turso database + optional S3-compatible object
> storage). Adjust hostnames, project names, and tooling to your environment and
> fill in the **⟨bracketed⟩** operational specifics for your deployment.

---

## 1. Objectives (set with the customer, then hold to them)

| Metric | Target | Basis |
|---|---|---|
| **RPO** (max data loss) | **≤ 24h** default; **≤ 1h** with continuous DB replication | Backup cadence (§3) |
| **RTO** (max downtime) | **≤ 4h** for app/container loss; **≤ 8h** for full DB restore | Restore procedure (§5) |
| Backup retention | 30 days rolling (+ monthly cold copy) | ⟨policy⟩ |
| Restore rehearsal | Quarterly | §7 |

These are starting numbers appropriate to a pilot. Tighten RPO by enabling
managed-database point-in-time recovery (Turso/Postgres) before production scale.

---

## 2. What has to be recoverable (the asset inventory)

1. **The database** — the system of record: orgs, users, assets, work orders +
   lifecycle events, PMs, parts, documents/chunks (the RAG index), audit log,
   OEM failure signals. This is the crown jewel.
2. **Object storage** — uploaded original files (manuals, drawings, photos, PLC
   exports) if S3-compatible storage is configured; otherwise the local
   `./uploads` volume.
3. **Configuration & secrets** — runtime environment: `DATABASE_URL` +
   `DATABASE_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OIDC_*`, `STORAGE_S3_*`,
   `AUTH_REQUIRED`, etc. **Never** in git — stored in the deploy platform's
   secret store / a vault. Losing these is a recovery blocker; back them up
   securely and separately.
4. **The application image / source** — reproducible from the canonical git
   branch (`git clone` + `docker build`). No unique state lives in the image.

---

## 3. Backup strategy

- **Database (managed — recommended):** use the provider's automated backups +
  point-in-time recovery (Turso branch/dump; or Postgres PITR after migration).
  Verify the schedule is active and retention matches §1.
- **Database (self-managed / file):** scheduled dump on a cron —
  `⟨turso db shell … .dump⟩` or a file copy of the libSQL file — to encrypted
  off-host storage (a different region/account than production). Timestamp every
  artifact.
- **Object storage:** enable bucket versioning + lifecycle retention on the
  S3-compatible store; cross-region replication for the ≤1h RPO tier.
- **Secrets:** keep the authoritative copy in the platform secret manager; keep a
  sealed break-glass copy (e.g. an encrypted vault export) accessible to two
  named operators.
- **Integrity:** a backup you haven't restored is a hypothesis. See §7.

---

## 4. Failure scenarios → response

| Scenario | Detection | First response |
|---|---|---|
| **App/container down** | `/api/health` unreachable or 5xx; uptime monitor page | Redeploy the image from the canonical branch; env from secret store. No data action needed (state is in the DB). |
| **DB unreachable, data intact** | `/api/health` → `status: degraded`, `checks.database: down` | Check DB provider status, `DATABASE_URL`/token validity, network/firewall. Restore connectivity; app recovers automatically. |
| **DB data loss / corruption** | Integrity errors; missing rows; failed acceptance test | Full restore from latest good backup (§5). Communicate RPO window to customer. |
| **Object storage loss** | Broken document downloads; upload failures | Restore bucket from versioning/replica; DB metadata (documents/chunks) remains and keeps the Copilot grounded even before originals return. |
| **Region / provider outage** | Multiple checks fail; provider status page | Fail over to secondary region (DB replica + redeploy app) if provisioned; else wait on provider + keep customer informed. |
| **Secret compromise** | Alert / suspected leak | Rotate the affected keys immediately (`ANTHROPIC_API_KEY`, DB token, OIDC secret, webhook secrets), invalidate sessions, review the audit log. See §6. |

---

## 5. Restore procedure (DB loss — the primary drill)

1. **Declare** the incident; assign an incident lead; start a timeline log.
2. **Stop writes** — put the app in maintenance or scale to zero so no new writes
   race the restore.
3. **Provision a clean database** (or a fresh branch) and capture its
   `DATABASE_URL` + token.
4. **Load the latest good backup** into it (`⟨.dump⟩` restore / provider PITR to a
   timestamp just before the incident). Note the exact recovery point.
5. **Point the app** at the restored DB (update the secret), then run migrations
   if applicable (`migrate()` / boot DDL is idempotent).
6. **Verify** (§ below) before reopening to users.
7. **Reopen** traffic; monitor `/api/health` and error logs (`route.unhandled_error`)
   for 30–60 min.
8. **Post-incident:** record actual RPO/RTO achieved, root cause, and corrective
   actions; update this runbook.

**Verification checklist (must pass before reopen):**
- `curl https://⟨host⟩/api/health` → `{"status":"ok","checks":{"database":"ok"}}`.
- Sign in; confirm the expected org(s) and a known recent work order exist.
- Tenant-isolation spot check: a user in Org A cannot see Org B's data.
- Run the **daily-loop acceptance test**: open → work → close a work order; ask
  the Copilot a grounded question and confirm citations return.
- Audit log shows continuity (no gap beyond the RPO window).

---

## 6. Secret-compromise sub-procedure

1. Rotate the compromised secret at the source provider; update the platform
   secret store; redeploy so the new value takes effect.
2. If a session/signing secret or the DB token is implicated, **invalidate all
   sessions** (rotate session secret / clear the sessions table) — users re-auth.
3. Rotate webhook signing secrets; notify integration owners.
4. Review the `audit_log` for the exposure window; scope impact per tenant.
5. Document and, if contractually required, notify affected customers.

---

## 7. Rehearsal (do not skip)

- **Quarterly:** perform a real restore of the latest DB backup into a scratch
  environment and run the §5 verification checklist. Record the time it took —
  that number is your *actual* RTO, not the target.
- **After any schema or infra change:** re-test the restore path.
- **Annually:** a full game-day including secret rotation and a simulated region
  failover.

A restore that has never been executed is not a recovery capability. The drill
is the deliverable.
