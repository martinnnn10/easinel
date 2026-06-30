# EAS Intelligence: Master Strategy & Architecture Package

This package contains the foundational strategy and architecture for EAS Intelligence. It was developed from first principles by the founding team to guide the next decade of development.

## Strategic Pivot (The Governing Decisions)

Following a rigorous red-team critique of the initial assumptions, the executive team has locked the following five decisions to govern all future development:

1. **Platform Identity:** We are the **AI-native Maintenance OS**. For new customers, we are the system of record. For enterprise customers, we integrate with SAP/Maximo. We do not frame ourselves as "replacing the CMMS" to avoid friction, but we own the daily workflow.
2. **The Wedge:** We own one problem: **"A machine is down."** Every feature must support the troubleshooting workflow for the technician.
3. **Competitive Moat:** **Cross-Customer Learning.** We pool anonymized failure/fix data at the OEM make/model level. Every repair makes the platform smarter for every other customer.
4. **Time-to-Value:** **Pre-seeded OEM Knowledge.** The system is pre-loaded with manuals and fault codes so the Copilot is useful on Day 1, before the customer uploads a single document.
5. **Year-10 Extensibility:** Our mission is *"Every machine should remember everything that has ever happened to it and help the next technician solve the next problem faster."* Today we are the Maintenance OS. By Year 10, the architecture must support expanding into Controls, Reliability, Operations, and Quality as the Intelligence Layer for Industrial Operations.

## Deliverables

0. **[The EAS Intelligence Constitution](./00_CONSTITUTION.md)**
   - The enduring engineering and product principles that govern every decision.

1. **[Product Strategy & Competitive Position](./01_PRODUCT_STRATEGY.md)**
   - The Core Problem (The Knowledge Crisis)
   - The EAS Intelligence Strategy (AI-native Maintenance OS)
   - Competitive Landscape & The Cross-Customer Moat
   - Why Customers Will Pay For It

2. **[Five-Year Product Roadmap](./02_ROADMAP.md)**
   - Year 1: The Daily Habit (Troubleshooting + Work Orders)
   - Year 2: Maintenance Memory & Cross-Customer Learning
   - Year 3: Predictive Intelligence
   - Year 4: Fleet-Wide Federation
   - Year 5: The Intelligence Layer for Industrial Operations

3. **[Platform Architecture & Domain Model](./03_PLATFORM_ARCHITECTURE.md)**
   - Core Architectural Principles
   - High-Level System Components
   - Core Entities (Asset, Knowledge, Events, Workforce)
   - Entity Relationships

4. **[Knowledge Graph Design & AI Architecture](./04_KNOWLEDGE_AND_AI.md)**
   - Graph Ontology & Node Types
   - Edge Relationships & Ingestion
   - The Reasoning Engine (Calibrated Diagnostic Assistant)
   - The RAG Pipeline & Pre-seeded Embedding Strategy

5. **[System Architecture](./05_SYSTEM_ARCHITECTURE.md)**
   - Database Architecture (libSQL to PostgreSQL migration path)
   - Service & Event Architecture
   - API Standards
   - Security Model (RBAC, Multi-Tenancy, Audit Logging)
   - Scalability Strategy

---

## Alignment with the Current Codebase

This architecture is grounded in the reality of the existing `eas-ic-fresh` codebase.

- **The Digital Twin (Slice 1):** The foundation of the Domain Model is already implemented. `src/lib/assets/repository.ts` enforces the strict database isolation described in the System Architecture. The UI (`/assets/[id]`) surfaces the computed reliability metrics and alarm history.
- **The Daily Habit (Slice 2 - Next):** The focus shifts to work orders, the mobile-first troubleshooting loop, and pre-seeded OEM knowledge.
- **The RAG Pipeline & Embeddings:** The dual-provider embedding strategy described in the AI Architecture is implemented in `src/lib/embeddings/index.ts`, ensuring deterministic keyword fallback when offline.
- **Security & RBAC:** The multi-tenant, org-scoped security model is actively enforced in `src/lib/auth/roles.ts` and `src/lib/auth/guard.ts`.
- **Event-Driven Foundation:** The repository layer emits domain events (`emitEvent()`), laying the groundwork for the asynchronous workers described in the Service Architecture.
