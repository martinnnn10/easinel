# Knowledge Reuse Impact — build spec (HOLD until production audit passes)

> Status: **NOT STARTED — blocked.** Do not build until:
> 1. Manus deploys the latest clean build
> 2. Production no-demo-data audit passes
> 3. Clean org starts empty
> 4. ROI + machine-memory pages proven to use real customer data only
>
> Frame this as **"Knowledge Reuse Impact"**, NOT a contributions dashboard or
> leaderboard. Impact over volume. Do not gamify quantity. Do not reward junk.

## Goal
Show when captured maintenance knowledge was reused and whether it helped reduce
downtime. Close the loop:

    knowledge captured → surfaced later → used by a technician → linked to a
    work order → outcome measured → impact shown

## Events to track (append-only reuse log)
- prior_fix_surfaced
- scenario_surfaced
- lesson_surfaced
- document_cited
- prior_fix_linked_to_work_order
- prior_fix_used_in_closeout
- pm_suggested_from_repeat_failure
- pm_created_from_failure
- pm_approved_from_failure

## Each event includes
- orgId
- assetId
- workOrderId (if applicable)
- sourceType: prior_work_order | scenario | lesson | document | PM
- sourceId
- surfacedToUserId
- originalAuthorUserId (if known)
- timestamp
- action taken
- outcome (if available)

## Manager-facing "Knowledge Reuse Impact" section
1. Most reused fixes
2. Most helpful machine memories
3. Repeat failures caught at intake
4. Work orders assisted by prior knowledge
5. PMs created from repeat failures
6. Downtime hours reduced — ONLY when supported by real comparison data
7. Dollar impact — ONLY when admin has entered downtime cost per hour

If not enough history to calculate savings, say exactly:
> "Not enough history yet to calculate avoided downtime."

Do NOT invent avoided downtime. Do NOT invent savings. Do NOT use industry
defaults unless clearly labeled as a demo estimate AND only in demo mode.

Example manager line (only when data supports it):
> "Jose's F007 repair note was surfaced 8 times, linked to 3 work orders, and
> associated with 4.5 fewer downtime hours compared with prior F007 events on
> this asset."

## Attribution rules
- Credit the person who captured the original useful knowledge
- Credit the technician who reused it successfully
- No public ranking by default
- Manager/admin-facing first
- Focus on impact, not volume

## Required safeguards
- No demo data in production
- No fake contribution examples
- No seeded reuse history in real orgs
- No dollar savings without real downtime AND a configured cost rate
- No broad "saved money" claims unless backed by closed work orders

## Acceptance criteria
- A clean org shows an honest empty state
- The first captured lesson creates no fake value yet
- When that lesson is surfaced later, reuse is logged
- When a WO is closed using the prior fix, reuse is linked
- If downtime improves versus similar prior failures, show impact
- If not enough data, show the honest "not enough history" message
- `npm test` passes
- `npm run build` passes
- Browser verification confirms no fake ROI

## Implementation note (for when unblocked)
The net-new primitive is an append-only **reuse-events log** (its own table),
written from the existing surfacing + close-out paths:
- recurrence "seen before" card at WO intake → prior_fix_surfaced / scenario_surfaced
- Copilot citations → document_cited / lesson_surfaced
- close-out that references a surfaced prior fix → prior_fix_used_in_closeout
- Suggest-PM from repeat failure → pm_suggested/created/approved_from_failure

Impact (avoided downtime) is computed by comparing the assisted WO's downtime
to the median of prior same-fault events on the same asset — and only shown
when there are enough prior events to make the comparison honest.

The audit-log actor→user resolver from the reverted Contributions work
(id-or-email, case-insensitive) is reusable for attribution here.
