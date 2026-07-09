# Demo Readiness Runbook

The engine is a 9.5; the demo dies on an empty workspace. This runbook makes the
live workspace read as **lived-in** and removes the leftover test data a prospect
would notice. Everything here runs **on the production VM** (the app root, where
`DATABASE_URL` points at the real DB) — it can't be done from a code sandbox.

Two things already ship in the app code (no action needed, live after deploy):

- **Copilot "Recent Assets" now hides retired machines.** "Test VFD" /
  "Test Conveyor" no longer appear there. (`src/app/api/home/route.ts`)
- **Sidebar "Advanced" starts collapsed** for everyone, so a first impression
  leads with the daily workflow, not PLC Explorer / Scenarios / Sessions.

The rest is data, done with two scripts. Both are **dry-run by default**, scoped
to one org, and print exactly what they'll do before you add `--apply`.

---

## 0. Find your org id

```bash
# from the app root on the VM
node -e "import('@libsql/client').then(async({createClient})=>{const db=createClient({url:process.env.DATABASE_URL??'file:local.db'});for(const r of (await db.execute('SELECT id,name FROM orgs')).rows)console.log(r.id,r.name)})"
```

Copy the id for your production org (starts with `org_`). Call it `$ORG` below.

---

## 1. Populate a lived-in workspace

`scripts/populate-demo-workspace.mjs` builds an **interlinked** dataset from one
editable block: assets → recurring closed work orders (real downtime + root
cause) → PMs → captured lessons → reuse events. That's what makes the
**Reliability Command Center**, **Reuse Impact**, and **Copilot** light up — data
you can't reproduce by hand because the reuse graph is what proves value.

**First, edit the `ASSETS` block at the top of the script** to the machines on
the floor you're demoing (or your client's real floor — fake-looking data is what
kills a demo; the script just wires up whatever real nouns you give it).

```bash
# dry-run — shows the record counts and the ~$ the hero will display
node scripts/populate-demo-workspace.mjs --org $ORG

# apply (optionally set the downtime $/hour used for the dollar figures)
node scripts/populate-demo-workspace.mjs --org $ORG --apply --rate 2200
```

Then open `/reliability`, `/impact`, `/copilot`, `/work-orders` — the workspace
now reads as a real plant with history.

Every row it creates has a `demoseed_` id. To reset completely:

```bash
node scripts/populate-demo-workspace.mjs --org $ORG --undo --apply
```

> Safe by construction: requires `--org`, aborts if the org doesn't exist, only
> ever touches `demoseed_` rows in that one org, and never writes without
> `--apply`.

---

## 2. Clean leftover test data (QA sessions + wrongly-archived PMs)

`scripts/demo-prep.mjs` **shows before it touches anything**: every archived PM
with the audit-log reason it was archived (so you can tell a real "— Test VFD"
cleanup from a genuine PM swept by mistake), and every Copilot conversation with
a preview of its first question (so you can spot the automated QA runs).

```bash
# report — lists archived PMs (with reason) and all conversations
node scripts/demo-prep.mjs --org $ORG
```

Then act on the exact ids it printed:

```bash
# restore real PMs that shouldn't be archived → back to 'draft' (visible again)
node scripts/demo-prep.mjs --org $ORG --restore-pms pm_aaa,pm_bbb --apply

# delete your own QA/test troubleshooting sessions
node scripts/demo-prep.mjs --org $ORG --purge-sessions cv_xxx,cv_yyy --apply
```

> Restoring a PM sets it to `draft` (visible in the default PM view, not
> auto-scheduling) and writes an audit row — reversible in the UI. Purging a
> session deletes that conversation + its messages; it's the one irreversible
> action, meant only for your own QA junk, and the ids are echoed back first.

### About the "5 Allen-Bradley PMs" you saw archived

`scripts/archive-test-data.mjs` only ever targeted PMs titled **"— Test VFD"** and
**"Test Conveyor"**, matched by exact id with a name-assertion guard — it does not
match Allen-Bradley PMs. Run the `demo-prep` **report** above: it prints each
archived PM's audit reason, so you can confirm what was archived and restore any
real ones by id. If a real PM shows `pm.archived — "Archived as owner-created
test data cleanup."` at an id you didn't expect, that's the one to restore.

---

## 3. After populating — verify the trust signals

- `/api/health` → `aiProviderConfigured:true`, `provider:"anthropic"`,
  `mode:"live"` (set `ANTHROPIC_API_KEY` in the VM env, not in chat).
- `/reliability` hero shows avoided downtime + a coverage %; repeat-risk machines
  list with PM status; "Sharpen the Copilot" lists any machine with no own docs.
- `/copilot` Recent Assets shows only working machines; Recent Sessions read like
  real shift work.
- `/knowledge` lists the uploaded manuals/drawings (no `test_upload_audit.pdf`).
