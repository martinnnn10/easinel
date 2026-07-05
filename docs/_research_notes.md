> **HISTORICAL STRATEGY DOCUMENT — NOT CURRENT PRODUCT SCOPE.** Any ATS/HRIS/recruiting/workforce-intelligence concepts below were explored and rejected. EAS Maintenance Intelligence is an AI maintenance platform (assets, work orders, PMs, Copilot, machine memory). Recruiting features are not part of the product.

# Research grounding — EAS Intelligence strategy package

## Market pain (the "why now")
- Unplanned downtime costs industrial manufacturers ~**$50B/year** (US sector); for the world's largest manufacturers it can equal **~11% of annual revenue** (~$1.4T aggregate). [arda.cards, Sumitomo, info2soft 2026]
- Average unplanned downtime cost **~$1.7M/hour**; a single major incident can reach **$42.6M**. [Fluke/SDCExec 2025]
- Splunk "Hidden Costs of Downtime": large companies lose **~$300M/year** to outages; 43% of downtime events tied to... (operational/human factors).
- **Knowledge loss / silver tsunami:** 40–50% of the maintenance & reliability workforce will be at/near retirement age within ~5 years; ~27% of manufacturing workforce retiring; documented multi-$10M knowledge-loss incidents (BP-Husky, $47M case). [MaintainX, Dirac, Bonjoy 2025-26]

## Market size (multiple framings)
- **CMMS:** ~$1.29B (2024) → ~$2.41B (2030).
- **EAM:** ~$5.87–7.39B (2025/26) → ~$9–16B (2030-34), CAGR ~9–11%.
- **Industrial asset management software (Verdantix):** → **$17B by 2030, ~15% CAGR**.
- Implication: the prize is not "CMMS" — it is the **intelligence layer** spanning CMMS + EAM + PdM + DMS + historian + controls.

## Competitive landscape
- **MaintainX** — Series D **$150M at $2.5B valuation (Jul 2025)**; mobile-first CMMS aggressively adding AI/PdM + EAM. The category leader to differentiate from.
- **Tractian** — unified CMMS + sensor-based condition monitoring, offline execution.
- **Augury / Fiix (Rockwell) / IBM Maximo / SAP EAM** — incumbents; Maximo/SAP heavy/slow, sensor vendors (Augury) own vibration.
- **Industrial knowledge graph players:** Cognite, Siemens (Graph RAG), SymphonyAI, DeepIQ, Datamesh — proving the "semantic layer over siloed industrial data" thesis, but aimed at data-science teams / large enterprise, not the technician on the floor.
- **White space:** nobody owns the **technician-grade reasoning layer** that unifies CMMS + controls/PLC + documents + tribal knowledge into one graph and answers the actual diagnostic question at the machine. PdM tells you *something will fail*; CMMS tracks the *ticket*; neither *reasons about why and tells you how to fix it using this plant's own history*.

## Strategic reading
- Don't build another CMMS/EAM/PdM/DMS/LMS/ATS. Become the **intelligence layer** that integrates them. Open integrations; never lock to proprietary hardware.
- The durable moat is the **plant-specific knowledge graph + accumulated resolved-failure memory** — it compounds and competitors can't copy it because it's the customer's own data, structured.

## Existing codebase reality (what we already have to build on)
- Next.js 15 (App Router) + React 19 + TS + Tailwind v4; libSQL/Turso via Drizzle; standalone output.
- Domain already present: assets (now rich digital twin — Slice 1 done), documents+chunks (RAG), PLC import/parse (L5X→IR, Explorer), work orders, conversations/messages (Copilot), technicians/workforce, lessons, alarm_events (new), embeddings provider interface (new), auth + RBAC + audit + events scaffold, public /api/v1.
- Deployed on Cloud Computer (34.138.183.7:3020) under PM2 (separate older zip build); active dev in /home/ubuntu/eas-ic-fresh.
- Slice 1 (Asset Intelligence / Digital Twin) shipped: repository isolation layer, twin aggregation + reliability metrics, photos, alarms, UI, tests, docs.

## Positioning (locked by user)
- **EAS Intelligence — "The Manufacturing Intelligence Platform."** Broader than maintenance: serves maintenance, reliability, automation/controls, engineering, operations, and manufacturing leadership.
