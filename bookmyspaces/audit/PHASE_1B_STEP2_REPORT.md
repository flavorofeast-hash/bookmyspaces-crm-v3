# Phase 1B — Step 2 Implementation Report
**Database: `unified_messages` idempotency + `orchestration_decisions` observability table**

Baseline: commit `fa7df34` (Step 1 merged, 38/38 files, 325/325 tests). Step 2 approved via `PHASE_1B_STEP2_READINESS_REVIEW.md`.

---

## Files Modified
- `package.json` — one line added to `scripts`: `"db:smoke-test:orchestration-observability": "node scripts/smoke-test-orchestration-observability.mjs"`. No existing script line touched. Flagged explicitly since it's one file beyond the readiness review's original list — rationale below.

## Files Created
- `supabase/migrations/025_orchestration_observability.sql`
- `supabase/migrations/025_orchestration_observability_ROLLBACK.sql`
- `scripts/smoke-test-orchestration-observability.mjs`

**On the third new file, not in the original "new files" list:** the approved readiness review's Section 9 required three specific integration tests (duplicate-insert rejection, null-safe partial index, `orchestration_decisions` FK/RLS check) and Section 12's acceptance criteria requires them to pass. This repo has no in-sandbox Postgres access (same constraint documented for migrations 012/013 — `scripts/apply-v3-migrations.mjs` and `scripts/smoke-test-v3.mjs`'s own headers), so the only way to fulfill that already-approved requirement is a script the user runs locally against a real `DATABASE_URL`, exactly like the existing `db:smoke-test:v3` convention. This new script is scoped only to migration 025, doesn't touch `smoke-test-v3.mjs`, and is the mechanism for satisfying Section 9/12 of the review you already approved — surfacing it plainly rather than treating it as implied.

## Database Changes

Not yet applied to any environment (this sandbox has no `DATABASE_URL`/network path to Supabase — confirmed, same constraint as every prior migration in this project). Draft, reviewed, ready to apply:

1. `CREATE UNIQUE INDEX IF NOT EXISTS unified_messages_channel_external_id_uq ON unified_messages (channel_id, external_message_id) WHERE external_message_id IS NOT NULL;` — partial, additive, no lock beyond a standard `CREATE INDEX`'s normal write-blocking window (no `CONCURRENTLY`, matching this repo's own migration convention — none of 001–024 use it).
2. `CREATE TABLE IF NOT EXISTS orchestration_decisions (...)` — new, standalone table, FKs into `unified_conversations`/`unified_messages`, RLS enabled with a `service_role`-only policy (identical shape to every migration-012 table's policy).

Both are idempotent (`IF NOT EXISTS`) and additive-only — no existing column, table, or constraint is altered or dropped by the forward migration.

**To apply** (when ready, from a machine with real `DATABASE_URL` access):
```
psql "$DATABASE_URL" -f supabase/migrations/025_orchestration_observability.sql
DATABASE_URL="$DATABASE_URL" npm run db:smoke-test:orchestration-observability
```

## Test Results

**Unit tests:** none added — no `src/` application code changed, so there is no new TypeScript logic to unit-test. This matches the readiness review's own Section 8 conclusion ("schema changes have no unit-testable application logic").

**Scoped Vitest run (in-sandbox):**
```
npx vitest run src/lib/settings/settings-service.test.ts
 ✓ src/lib/settings/settings-service.test.ts  (13 tests) 5ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```
Full 38-file suite: attempted twice in-sandbox; both runs were cut off by this sandbox's per-command time limit before any file reported (same documented `googleapis`-dependency I/O latency as every prior full-suite attempt here, not a failure). Since **zero files under `src/` were touched in this step** (confirmed by grep below), there is no mechanism by which the existing 325 tests could regress — but the authoritative 38/38 count still needs a local `npm test` run to confirm, per this project's established "local is authoritative" standard.

**Lint:**
```
npm run lint          → exit 0 (full project, ran to completion in-sandbox)
npx eslint scripts/smoke-test-orchestration-observability.mjs → exit 0
```

**TypeScript:**
```
npx tsc --noEmit      → exit 0 (full project, ran to completion in-sandbox, zero errors)
```
(The new `.mjs` script is plain Node/JS, not part of the TypeScript project — `tsc --noEmit`'s clean pass confirms it introduced no regression to any `.ts` file, which is the only thing this step could have affected.)

**Zero-wiring check (grep, full `src/` tree):**
```
grep -r "orchestration_decisions|unified_messages_channel_external_id_uq" src/
→ no matches
```
Confirms neither new schema object is referenced anywhere in application code.

## Risk Assessment

**Risk: Low**, same tier as Step 1. No application code changed at all. The migration is additive/idempotent and was traced against the one real code path that touches `unified_messages` (the webhook's fire-and-forget Unified Conversation Platform mirror) during the readiness review — no retry logic exists there, so the new unique index can only ever reject a genuine Meta webhook redelivery, converting a silent duplicate row into one logged rejection with zero effect on the customer-facing reply. The one net-new file beyond the original plan (the smoke-test script) carries no runtime risk — it's a manually-invoked, transaction-rolled-back diagnostic tool, not something the application executes.

## Rollback Procedure

```
psql "$DATABASE_URL" -f supabase/migrations/025_orchestration_observability_ROLLBACK.sql
```
Drops `orchestration_decisions` (policy included) and the new unique index, in that order. If only the index turns out to be the problem, it alone can be dropped without the rest: `DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;`. Either way: safe unconditionally, since nothing reads or writes either object yet. To revert the code-level additions: revert the one `package.json` line and delete the three new files — no data migration to undo for those.

---

## Explicit Confirmations

- **The orchestration feature flag is still disabled.** Step 2 did not touch `src/lib/settings/settings-service.ts` at all — `orchestration.enabled` remains `false`, exactly as Step 1 left it.
- **No runtime orchestration path has been activated.** Confirmed by the grep above: nothing in `src/` references either new schema object. `orchestrate()` remains completely unwired, exactly as it was at the `phase-1a.1-complete` baseline.
- **No customer-visible behavior has changed.** Zero `src/` files were modified. The one schema change with any live-data interaction (the unique index) has not even been applied to any database yet — it exists only as a reviewed, not-yet-run SQL file.
- **Step 2 remains independently deployable and independently reversible.** The two SQL files can be applied to staging/production independently of any other Phase 1B step (no code depends on them yet); the rollback file (or the narrower index-only drop) reverses them at any time with zero downstream effect.

**Step 2 complete. Stopping here per instruction — awaiting approval before Step 3.**

---

## Step 2 Close-Out

**Status: ✅ COMPLETE (provisionally accepted).** Baseline for this close-out: Step 2 as implemented above, reviewed by the user, provisionally accepted before Step 3.

### Files Modified
- `package.json` — one line added to `scripts` (`db:smoke-test:orchestration-observability`). No existing line changed.

### Files Created
- `supabase/migrations/025_orchestration_observability.sql`
- `supabase/migrations/025_orchestration_observability_ROLLBACK.sql`
- `scripts/smoke-test-orchestration-observability.mjs`

### Database Objects Added
- Unique index `unified_messages_channel_external_id_uq` on `unified_messages (channel_id, external_message_id)`, partial (`WHERE external_message_id IS NOT NULL`).
- Table `orchestration_decisions` (columns: `id`, `created_at`, `conversation_id`, `message_id`, `mode`, `action`, `reason`, `had_conflicts`, `conflicts`, `executed`), with two supporting indexes (`idx_orchestration_decisions_conversation_id`, `idx_orchestration_decisions_created_at`), RLS enabled, and a `service_role`-only policy.
- **Not yet applied to any database** — drafted and reviewed only, per the earlier report. Applying it is a separate, still-pending action for whoever holds `DATABASE_URL` access.

### Rollback Procedure
```
psql "$DATABASE_URL" -f supabase/migrations/025_orchestration_observability_ROLLBACK.sql
```
Or, narrower, index-only: `DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;`. Code-level revert: remove the one `package.json` line and delete the three new files — no data migration needed since nothing was ever applied.

### Risks Introduced
- **New, not-yet-applied schema surface** (index + table) that must eventually be applied to production — a deploy step now exists that didn't before, and it needs the same `DATABASE_URL`-holding operator every prior V3 migration (012/013) has needed, since no sandbox in this project's history has had network access to Supabase.
- **The unique index's one theoretical edge case**, already traced and judged low-probability in the readiness review: a genuine Meta webhook redelivery will now surface as one logged, rejected insert instead of a silent duplicate row — a detection improvement, but it does mean a new class of log line (an insert failure) can now appear in production that never could before. Worth a note to whoever monitors application error logs so it isn't mistaken for a new bug the first time it's seen.

### Risks Eliminated
- `unified_messages` previously had **no** enforceable idempotency guarantee at all for `(channel_id, external_message_id)` — only a plain lookup index. That gap is closed for any future caller that relies on it (Step 6 onward), even though nothing calls it yet.
- The Phase 1B design's shadow-mode plan (Step 6) previously had **no persistence target** — "log it" had nowhere durable to go. `orchestration_decisions` removes that blocker before Step 6 needs it.

### Deviations from the Approved Design
**Not "None" — one real, disclosed deviation:** `PHASE_1B_STEP2_READINESS_REVIEW.md`'s Section 4 listed exactly two new files (the migration + its rollback). Implementation added a third — `scripts/smoke-test-orchestration-observability.mjs` — plus one line in `package.json` to register it as an npm script. This was surfaced explicitly in the original Step 2 report (see "Files Created" above) at the time of implementation, not discovered after the fact. Rationale: the same readiness review's own Section 9 (integration tests required) and Section 12 (acceptance criteria) call for three specific DB-level tests that have no mechanism in this project other than a manually-run script against a real `DATABASE_URL` — the exact pattern this repo already established for migrations 012/013 (`scripts/smoke-test-v3.mjs`). No other deviation occurred: the migration's actual DDL matches the readiness review's draft SQL verbatim, no additional table/column/index was added beyond what was reviewed, and no `src/` application file was touched, as promised.

## Known Follow-up Items

Carried forward for whoever plans Phase 1B's later steps or a separate maintenance pass — none of these block Step 3, and none were introduced by Step 2:

- **Next.js security update, still outstanding.** `audit/PHASE_1B_RELEASE_GATE_REVIEW.md` (Section on dependency tiering) identified `next@14.2.5` — the version still in `package.json` today, re-confirmed during this close-out — as carrying a critical/high CVE cluster (authorization bypass, SSRF via Middleware, cache poisoning, request smuggling) with `next@14.2.35` already identified as the in-range, non-major fix. That review recommended applying it "before production go-live." It has not been applied at any point across Phase 1A.1 or Phase 1B Steps 1–2. This is unrelated to Step 2's scope (no `src/` code touches Next.js internals) but remains a real, dated, open item.
- **Secret management issues.** Two concrete findings, neither introduced by Step 2: (1) `src/app/api/whatsapp/webhook/route.ts`'s own signature check degrades to a logged warning rather than a rejection when `WHATSAPP_APP_SECRET` is unset (`verifySignature()` returns `'unconfigured'`) — meaning webhook signature verification is opt-in-by-environment-variable rather than enforced, a real gap if that variable is ever missing in production. (2) The connected working folder currently contains `.env.local`, `.env.production.local`, and a dated backup file `.env.local.20260603.backup`; `.gitignore` covers the first two by pattern (`.env.local`, `.env.*.local`) but had to special-case the backup file by its exact literal filename (line 50) rather than a pattern — meaning any *differently-named* future backup of the same kind would not be automatically excluded. Not verified (no git access in this sandbox) whether any of these were ever historically committed before their gitignore rules existed; worth a one-time `git log --all --full-history -- '*.env*'`-style check by someone with real git access.
- **`MASTER_ENGINEERING_SPECIFICATION.md` location/name discrepancy.** Referenced by name in the Step 2 implementation instructions as one of the source documents to implement against. No file by that name (or a close variant) exists anywhere in the repository — checked again for this close-out. Every Step 2 decision was instead grounded directly in `PHASE_1B_IMPLEMENTATION_BACKLOG.md`, `PHASE_1B_STEP2_READINESS_REVIEW.md`, and direct inspection of migration 012's actual conventions. This discrepancy was flagged once already (Step 2 implementation report) and remains unresolved — worth clarifying whether this document exists under a different name/location, was planned but never written, or was a reference to a document from a different project.
- **Remaining design questions** (`audit/PHASE_1B_DESIGN_DOCUMENT.md`, Section 11 — unchanged by Steps 1–2, still open): (1) room/property selection isn't represented in slot memory today, so `check_room_availability`/`check_banquet_availability` can't yet resolve a concrete inventory item id from conversation data alone; (2) `generate_proposal` has no reservation to attach to at the point it would fire — the recommended interim behavior is downgrading to `notify_staff`, not yet approved or implemented; (3) the Stage 2 test-number allow-list mechanism (Step 7) isn't confirmed to exist anywhere in `send-message.ts` yet; (4) where the shadow-mode review surface lives (CRM addition vs. Cowork artifact vs. direct queries) is undecided; (5) whether `ask_question` ever gets a real trigger of its own or stays permanently unreachable is an open product decision, not a technical blocker.
