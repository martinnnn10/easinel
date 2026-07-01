# Enablement Documents

B2B enablement artifacts for evaluating, securing, deploying, and operating EAS
Industrial Copilot. Share under NDA during evaluation; keep versioned with the
deployment. Bracketed **⟨values⟩** are deployment-specific and must be filled in.

| Document | Audience | Use |
|---|---|---|
| [Security & Architecture Whitepaper](./SECURITY_ARCHITECTURE_WHITEPAPER.md) | Security / IT / architecture reviewers | How the platform is built and protects data |
| [Procurement Readiness Packet](./PROCUREMENT_READINESS_PACKET.md) | Procurement / vendor-risk / legal | Questionnaire answers, subprocessors, gap statement |
| [Disaster Recovery Runbook](./DISASTER_RECOVERY_RUNBOOK.md) | Platform operators / on-call | RPO/RTO, backup + restore procedure, rehearsal |
| [Customer Onboarding Checklist](./CUSTOMER_ONBOARDING_CHECKLIST.md) | Onboarding / customer success | Contract → confident daily use, phase by phase |

Related, at the repository root:
- [Enterprise Readiness Audit](../../ENTERPRISE_READINESS_AUDIT.md) — CTO-grade scorecard + commercial readiness
- [PostgreSQL Readiness Audit](../../POSTGRES_READINESS_AUDIT.md) — engine-migration assessment
- [DEPLOY.md](../../DEPLOY.md) — deployment guide + configuration reference

**Honesty note:** these documents distinguish what is **implemented today** from
what is **Roadmap / pilot-phase** (SOC 2, penetration test, DPA, SLA, dependency
scanning). They are written to be shared with a buyer as-is without overclaiming.
