# Slice 2 Implementation Plan: The Daily Habit

**Objective:** Own the moment a machine goes down. Build the daily troubleshooting and work execution loop so the product becomes indispensable to the technician, generating the data required for the cross-customer moat.

## Scope

### 1. Work Order State Machine (The Core Loop)
- **Repository:** `src/lib/work-orders/repository.ts` (strict libSQL/PostgreSQL isolation).
- **Entities:** `WorkOrder` (id, orgId, assetId, title, description, status, priority, type, assignedTo, createdAt, closedAt).
- **API:** `GET /api/work-orders`, `POST /api/work-orders`, `PATCH /api/work-orders/[id]`.
- **RBAC:** `view_work_orders`, `manage_work_orders`.
- **Audit:** Every state transition (e.g., Open -> In Progress -> Closed) is audited.

### 2. Mobile-First Troubleshooting UX
- **The Breakdown Wedge:** A new mobile-optimized entry point. Instead of navigating a complex dashboard, the technician sees a simple search/scan bar: *"What is down?"*
- **Asset Copilot Integration:** Merging the Work Order view with the AI Copilot. When a technician opens a work order for an asset, the Copilot is pre-loaded with the asset's context and ready to diagnose.
- **Responsive Design:** Ensure the entire troubleshooting loop (Search -> Select Asset -> Open WO -> Chat with Copilot) works flawlessly on a 6-inch screen with one hand.

### 3. Pre-Seeded OEM Knowledge (The Cold Start Solution)
- **OEM Seed Data:** Modify the database seed script to inject public OEM manuals and fault codes for a set of common assets (e.g., Allen-Bradley PowerFlex 525).
- **Global Knowledge Resolution:** Update the RAG pipeline (`buildAssetContext`) to pull from both the tenant's specific knowledge base *and* the global, pre-seeded OEM knowledge base.
- **Result:** A brand new account can ask *"PowerFlex 525 F081"* and get a grounded answer immediately.

## Global Standards Checklist
- [ ] Database migration (idempotent, backward-safe)
- [ ] Backend API (RESTful, documented)
- [ ] Frontend UI (Mobile-first, loading/empty/error states)
- [ ] Tests (Unit tests for the repository and state machine)
- [ ] Documentation (Update SLICE2_DAILY_HABIT.md upon completion)
- [ ] RBAC & Audit logging enforced

## Execution Rule
As mandated by the implementation guidelines, this slice will be additive-only. It will not break the existing Slice 1 Asset Intelligence features, but will integrate with them (e.g., linking a Work Order to an Asset).
