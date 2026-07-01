# Powerful Feature Suggestions — EAS Industrial Copilot

High-impact features that would meaningfully improve the platform, each grounded
in capabilities that already exist in the codebase (so they are credible
extensions, not greenfield bets). Ordered by ROI-to-effort. "Builds on" points to
the real primitives already shipped.

---

## Tier 1 — Highest ROI, near-term (weeks)

### 1. Scenario-Driven Training & Competency Engine  ⭐ flagship
Turn the new **Scenarios** into a technician training + certification system.
Assign scenarios by skill level, let a tech work the diagnostic path, score them,
and auto-build onboarding tracks. Management sees a live competency matrix.
- **Why it wins:** maintenance orgs bleed knowledge when senior techs retire. This
  captures tribal knowledge (scenarios) AND transfers it (training) — a wedge no
  CMMS has. It also makes the Scenario Builder "sticky."
- **Builds on:** `scenarios` (just shipped), `technicians` + `skills` +
  `technician_skills` tables (already exist), RBAC, audit.
- **Effort:** Medium. Add scenario→assignment + attempt/score tables, a "practice"
  UI, and a competency dashboard.

### 2. Voice-First, Hands-Free Copilot
A technician in gloves at a live panel talks to the Copilot; speech-to-text in,
text-to-speech + citations out. "What do I check first on this F007?"
- **Why it wins:** the wedge is "a machine is down" and the tech's hands are full.
  Voice removes the last friction on the plant floor.
- **Builds on:** the existing Copilot streaming pipeline, asset-scoped context,
  citations. Add Web Speech API (browser) or Whisper for STT.
- **Effort:** Medium (browser STT/TTS is low; a robust noisy-plant path is more).

### 3. Automated RCA Report Generation
From a closed corrective work order (or a cluster of repeat failures on an asset),
generate a formal **Root Cause Analysis** — 5-Why / fishbone, evidence links, and
a recommended preventive action — as an exportable PDF.
- **Why it wins:** reliability engineers hand-write RCAs today; this drafts them
  from real captured data (downtime, root cause, failed part, repair action).
- **Builds on:** work-order close-out fields, Maintenance Memory, PM suggestion
  engine, `oem_failure_signals`.
- **Effort:** Low–Medium (a new prompt + template over existing data).

### 4. Shift-Handover Digest
Auto-generate an end-of-shift briefing: open work orders, machine states, what
changed, and what the next shift should watch — delivered to a screen or email.
- **Why it wins:** handover gaps cause repeat failures and missed follow-ups.
  Pure leverage of data already in the system.
- **Builds on:** work orders + events, alarms, assets, the event outbox/webhooks.
- **Effort:** Low.

---

## Tier 2 — Differentiators (1–2 months)

### 5. Cross-Customer OEM Intelligence Network (activate the moat)
The `oem_failure_signals` boundary already separates poolable OEM-level signal
from tenant-private data. Activate it (consent-gated): "Plants running this exact
PowerFlex 525 resolved F007 by clearing the panel cooling filter in 71% of cases,
median downtime 42 min." Anonymous, opt-in, and undeniably valuable at scale.
- **Why it wins:** THIS is the durable moat — a diagnostic model for common OEM
  equipment that no single-tenant tool can match.
- **Builds on:** `oem_failure_signals` (schema + emission already shipped, pooling
  off by default), consent flag `CROSS_CUSTOMER_LEARNING`.
- **Effort:** Medium (aggregation queries + consent UX + a "what the network
  knows" panel in the Copilot). Governance is the hard part, not the code.

### 6. Industrial Knowledge Graph + Signal Tracer
Trace a signal end-to-end: **sensor → PLC rung → HMI → asset → drawing → work-order
history**. A visual explorer for controls/reliability engineers.
- **Why it wins:** widens the wedge from technicians to controls engineers; the
  data silos already exist, just not connected.
- **Builds on:** PLC IR (`plc_projects`), assets, documents/drawings (+ the new
  drawing parser: tags, panels, PLC refs), work orders, parts.
- **Effort:** High (graph modeling + a visualization UI).

### 7. Condition-Monitoring Ingestion → Prescriptive Work Orders
Ingest vibration/thermal/motor-current trends (CSV, or Augury/Tractian/historian
connectors). On an anomaly, auto-draft a **prescriptive** work order with the
likely cause, parts, and manual pages — pending human approval.
- **Why it wins:** moves the product from reactive to predictive — the Year-3
  roadmap, reachable now for early adopters.
- **Builds on:** `alarm_events`, work-order draft path, PM engine, parts memory,
  the integrations adapter registry.
- **Effort:** High.

### 8. Real Drawing OCR + Symbol Recognition
Upgrade the honest H3 drawing parser: OCR image-only electrical PDFs and recognize
schematic symbols/tags so scanned drawings become searchable and Copilot-readable.
- **Why it wins:** most plant drawings are scanned PDFs; today they index no text.
  This unlocks a huge, currently-dark corpus.
- **Builds on:** the new `drawing.ts` parser + Knowledge detail (which already
  says honestly when a PDF is image-only), the RAG ingest pipeline.
- **Effort:** High (OCR + a vision model; cost/latency tradeoffs).

---

## Tier 3 — Platform & scale

### 9. Multi-Plant Fleet Intelligence
Enterprise view: benchmark identical assets across plants; a fix or PM change in
Plant A proposes the same to Plant B's identical machines.
- **Builds on:** per-org isolation, asset nameplate identity, `oem_failure_signals`.
- **Effort:** High (org-of-orgs / hierarchy model).

### 10. Offline-First PWA
Techs in basements/dead zones get the Copilot + that asset's documents offline,
syncing when back on network.
- **Builds on:** Next.js (service worker), asset-scoped document bundles.
- **Effort:** Medium–High.

### 11. Spare-Parts Optimization + ERP Auto-Reorder
Failure-rate-driven stocking recommendations; when a critical spare drops below
reorder point, draft a PO to the ERP.
- **Builds on:** parts memory (failure history, critical-spare flags, suppliers),
  the integrations adapter.
- **Effort:** Medium–High.

### 12. Compliance & Safety Pack
Generate LOTO procedures per asset, permit-to-work, and audit-ready maintenance
records; surface arc-flash / PPE references in the Copilot answer.
- **Builds on:** asset data, PM procedure templates, the audit log, OEM safety
  knowledge (the Copilot already refuses to bypass safety devices).
- **Effort:** Medium.

---

## Recommended sequence
1. **RCA generation** + **Shift-handover digest** (Tier 1, low effort, immediate
   "wow" from data you already capture).
2. **Scenario training engine** (flagship stickiness, uses tables that exist).
3. **Voice Copilot** (removes plant-floor friction on the core wedge).
4. **Activate the OEM moat** (the long-term defensibility).
5. Then the graph, condition-monitoring, and OCR as the platform matures.

Each of these is a genuine extension of shipped primitives — not a rewrite — which
is why they're realistic to build and credible to sell.
