# EAS Intelligence: Executive Decision Matrix

**Prepared by the Founding Team**

Based on the Governing Master Strategy Prompt and the Pre-Build Critique, we have identified a fundamental divergence between the initial roadmap (Slice 1-6) and the requirements for building a 20-year category leader. 

Before any further code is written, the executive team (you) must make the following strategic decisions.

---

## Decision 1: Platform Identity
*Are we an intelligence layer that sits on top of existing systems, or are we the system of record for maintenance execution?*

- **Option A (Current Plan): Intelligence Layer.** We integrate with SAP/MaintainX, pull their data, reason over it, and push insights back.
  - *Risk:* We do not own the user's daily habit. We are at the mercy of competitor APIs.
- **Option B (Recommended): System of Record.** We own the work order, the asset, and the troubleshooting workflow. We replace the CMMS.
  - *Advantage:* We own the data generation loop. We become indispensable.

## Decision 2: The Wedge
*Who are we building for right now?*

- **Option A (Current Plan): The Broad Platform.** We build features for technicians, reliability engineers, controls engineers, and plant managers simultaneously (e.g., PLC parsing in Slice 2).
- **Option B (Recommended): The Breakdown.** We build exclusively for the maintenance technician diagnosing a downed machine. Every feature outside of this workflow is deferred.
  - *Advantage:* Faster time to product-market fit. Clearer go-to-market messaging.

## Decision 3: The Competitive Moat
*What makes us impossible to copy?*

- **Option A (Current Plan): Single-Tenant Knowledge Graph.** A plant's data is strictly isolated. The moat is the switching cost of leaving their accumulated graph.
- **Option B (Recommended): Cross-Customer Learning.** We pool anonymized failure/fix data at the OEM make/model level. Every customer makes the platform smarter for every other customer.
  - *Advantage:* A true network effect. Competitors cannot replicate our diagnostic accuracy because they lack the aggregated dataset.

## Decision 4: Time-to-Value
*How does the product become useful?*

- **Option A (Current Plan): Customer-Uploaded.** The customer must upload their manuals and PLC files to train the AI.
- **Option B (Recommended): Pre-Seeded OEM Knowledge.** We pre-load the system with manuals and fault codes for the industry's most common assets.
  - *Advantage:* The Copilot is useful the moment an account is created, drastically reducing churn during the trial phase.

## Decision 5: Slice Reordering
*Based on the decisions above, the execution order must change.*

- **Current Approved Order:**
  1. Asset Intelligence (Done)
  2. Knowledge Engine + PLC Importers
  3. Work Orders + Maintenance Memory
  4. Copilot
- **Proposed Revised Order:**
  1. Asset Intelligence (Done)
  2. **The Daily Habit:** Work Orders + Mobile-First Troubleshooting Loop (Move up to capture the workflow).
  3. **The Brain:** Pre-Seeded OEM Knowledge + Copilot (Useful on Day 1).
  4. **The Moat:** Maintenance Memory (Capturing the fix).
  5. **The Wedge Widener:** PLC Importers & Graph Traversal (Defer until the technician workflow is proven).

---

### Next Steps
Please review these 5 decisions. Once you provide your directive on Platform Identity, The Wedge, and the Slice Reordering, we will update the Master Architecture and resume implementation of the next approved slice.
