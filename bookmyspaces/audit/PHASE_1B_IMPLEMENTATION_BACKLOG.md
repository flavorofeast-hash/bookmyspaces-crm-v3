# Phase 1B — Implementation Backlog

Derived from `audit/PHASE_1B_DESIGN_DOCUMENT.md`, Section 12 (the 9-step rollout). Baseline: commit `c2384ea`, tag `phase-1a.1-complete`.

## ✓ PHASE 1B COMPLETE

Steps 1–6 delivered, reviewed, and verified. Step 6 (this session) closed out Phase 1B's engineering work as the final step, per an explicit revised kickoff that redefined the rollout as a single flag-gated step rather than the originally-planned Steps 6–8 staged rollout (shadow mode → allow-list → 100%) — see Step 6's status note below and `audit/PHASE_1B_STEP6_REPORT.md`'s "Deviations" section for the full disclosure. `settings.orchestration.enabled` remains `false` (default, unflipped in every environment) as of Phase 1B's close. Full closing record, architecture summary, and recommended next steps: `audit/PHASE_1B_COMPLETION_REPORT.md`.

Steps 7, 8, and 9 below are the **original** staged-rollout plan as first drafted (before this session's revised Step 6 kickoff) and are kept here for historical record only — they were **not** built, and are superseded by Step 6's single-flag design. Any future staged rollout (shadow mode, allow-list) would need to be freshly scoped as new work, not resumed from these sections.

---

Status (historical, pre-Step-1): **planning only — no code has been written.** This backlog exists so Step 1 can be approved and scoped precisely before anything is touched.

Migration numbering confirmed against the repo: the latest applied migration is `024_event_sales_expansion.sql`, and every migration in this repo already ships with a paired `..._ROLLBACK.sql` file (`015` through `024` all follow this convention) — Step 2 below reuses that existing convention rather than inventing a new one.

---

## Step 1 — Add `OrchestrationSettings` config section

**Objective:** Introduce the kill-switch's storage, with no reader anywhere yet. Purely additive config.

**Files to modify:**
- `src/lib/settings/settings-service.ts` — add `OrchestrationSettings` interface, add `'orchestration'` to `SECTION_KEYS`, add its default to `DEFAULT_SETTINGS`.

**New files to create:** none.

**Existing files to remove:** none.

**Database changes:** none. `settings` is already a generic `category`/`key`/`value` JSONB store (migration 012) with `UNIQUE(category, key)` — a new `key = 'orchestration'` row is exactly the same shape as the existing `'ai'`/`'notifications'`/`'whatsapp'` rows. `getAppSettings()`'s existing merge-over-defaults behavior means no row needs to exist in the table at all until someone explicitly saves one; until then every reader gets `{ enabled: false, mode: 'shadow', channels: [], testNumbers: [] }` for free.

**API changes:** none. No route reads or writes this section yet. (The existing settings save API, if it does a generic `Partial<AppSettings>` upsert already, will accept an `orchestration` key the moment the interface exists — verify this at implementation time; if the save route hand-lists sections instead of using `Partial<AppSettings>` generically, that route needs a one-line addition, still zero behavior change since nothing calls it with this key yet.)

**Feature flag requirements:** this step *is* the flag. Default `enabled: false`. No UI toggle shipped in this step — flipped only via a direct `settings` table upsert (matching how `whatsapp.verifyToken` etc. are seeded today) until a UI is deliberately added later.

**Unit tests:** `settings-service.test.ts` (new or extended) — assert `getSettingsSection('orchestration')` returns the default when no row exists; assert `saveAppSettings({ orchestration: {...} })` round-trips; assert `getAppSettings()` still returns all four existing sections unchanged (no regression to `venue`/`ai`/`notifications`/`whatsapp` reads).

**Integration tests:** none required — no live path reads this yet.

**Regression tests:** full existing settings-service test suite must stay green, unmodified in its existing assertions.

**Rollback procedure:** revert the single file change. No data migration to undo (no schema change). If a row was accidentally saved to `settings` in a lower environment, `DELETE FROM settings WHERE category='app' AND key='orchestration'` — harmless, since nothing reads it.

**Risks:** near zero. Only risk is a TypeScript widening mistake that accidentally changes `AppSettings`'s shape for existing sections — guarded by the regression tests above and by `tsc --noEmit`.

**Acceptance criteria:** `getSettingsSection('orchestration')` is callable and typed; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass; zero other files changed.

**Definition of Done:** merged to the release branch on its own, tests green, no other Phase 1B step depends on anything beyond this file existing.

---

## Step 2 — Database migration: `unified_messages` idempotency + `orchestration_decisions` table

**Status: ✅ COMPLETE.** Implemented and provisionally accepted; see `audit/PHASE_1B_STEP2_REPORT.md` (Step 2 Close-Out section) for the full record — files touched, DB objects added, rollback procedure, risk changes, and the one disclosed deviation from this backlog's original file list (an additional smoke-test script + one `package.json` line, added to satisfy this same document's own Section 9/12 testing requirements, which had no other mechanism available). Migration not yet applied to any environment — still infrastructure-only, feature flag still `false`, still unwired.

**Objective:** Give `inbound-guard.ts`'s duplicate/replay check a real backing store, and give shadow mode somewhere durable to write decisions.

**Files to modify:** none in `src/`.

**New files to create:**
- `supabase/migrations/025_orchestration_observability.sql`
- `supabase/migrations/025_orchestration_observability_ROLLBACK.sql` (matches the existing 015–024 pairing convention exactly)

**Existing files to remove:** none.

**Database changes:**
```sql
-- 025_orchestration_observability.sql
CREATE UNIQUE INDEX IF NOT EXISTS unified_messages_channel_external_id_uq
  ON unified_messages (channel_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS orchestration_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES unified_conversations(id),
  message_id UUID REFERENCES unified_messages(id),
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'active')),
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  had_conflicts BOOLEAN NOT NULL DEFAULT false,
  conflicts JSONB,
  executed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE orchestration_decisions ENABLE ROW LEVEL SECURITY;
```
Rollback file drops both in reverse order (`DROP TABLE IF EXISTS orchestration_decisions;` then `DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;`), matching the existing `_ROLLBACK.sql` convention.

**API changes:** none — no route reads/writes these yet.

**Feature flag requirements:** none new; this is schema-only and inert until Step 6.

**Unit tests:** N/A (schema-only) — but add a migration-application smoke check consistent with however this repo already validates migrations (see `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` for the existing pattern) confirming `025` applies cleanly against a copy of the current schema and the rollback file cleanly reverses it.

**Integration tests:** attempt inserting two `unified_messages` rows with the same `(channel_id, external_message_id)` and assert the second is rejected by the new unique index (proves the constraint actually works, not just that it exists).

**Regression tests:** re-run the full existing schema validation / any existing DB test suite; confirm no existing query against `unified_messages` breaks (the partial index changes nothing for rows with a null `external_message_id`, which is the common case for non-webhook-originated messages).

**Rollback procedure:** run `025_orchestration_observability_ROLLBACK.sql`. Safe at any time before Step 6 wires a reader/writer, since nothing depends on this data yet.

**Risks:** the unique index could reject a duplicate `(channel_id, external_message_id)` pair that today's Pipeline A/B *legitimately* both write for the same wamid (Pipeline A's fire-and-forget mirror and, if ever reactivated, Pipeline B's own mirror) — needs a check against current mirror-write behavior (`syncToUnifiedConversationPlatform()`) before applying to production, specifically whether it's ever called twice for the same message id today. Flag as a pre-migration verification task, not a blocker to writing the migration.

**Acceptance criteria:** migration applies cleanly to a staging copy of the production schema; rollback applies cleanly after it; the duplicate-insert integration test passes.

**Definition of Done:** migration merged and applied to staging (not yet production, or applied to production but inert — team's existing migration-deployment convention decides which), verified against the risk above.

---

## Step 3 — Export `auto-responder.ts` templates + `notifyOperator()`

**Status: ✅ COMPLETE — approved.** Implemented exactly as approved in `PHASE_1B_STEP3_READINESS_REVIEW.md` and formally closed out; see `audit/PHASE_1B_STEP3_REPORT.md` (Step 3 Close-Out + Engineering Notes sections) for the full record — files touched, tests added, risks in/out, rollback procedure, and a factual account of one unexpected implementation event encountered mid-Step-3 (an unapproved test-file alteration, rejected and reverted before the report was finalized).

**Objective:** Turn two module-private pieces of already-correct, already-live logic into reusable exports, with zero change to their behavior or to `processAutoResponse()`'s existing call sites.

**Files to modify:**
- `src/lib/whatsapp/auto-responder.ts` — change `const MESSAGES = {...}` to `export const MESSAGES = {...}`; change `async function notifyOperator(...)` to `export async function notifyOperator(...)`. Add one missing template if needed to fully cover the funnel (`ASK_EVENT_TYPE`, since `GREETING` currently conflates greeting + the first question — needed cleanly separated so `collect_missing_information` can address `eventType` specifically without also re-greeting a returning customer).

**New files to create:** none.

**Existing files to remove:** none.

**Database changes:** none.

**API changes:** none.

**Feature flag requirements:** none — pure export visibility change.

**Unit tests:** extend `auto-responder.test.ts` (if one exists; create if not) — assert every exported template still renders identically to before (snapshot or direct string assertions) and that `processAutoResponse()`'s existing tests (if any) are unaffected by the export keyword change.

**Integration tests:** none required at this step.

**Regression tests:** any existing test that imports from `auto-responder.ts` must still pass unmodified — an `export` keyword addition should be strictly additive to the module's public surface.

**Rollback procedure:** revert the file; trivial, single-file, no data involved.

**Risks:** near zero — the only real risk is accidentally changing template *content* while touching the file, guarded by the regression tests requiring byte-identical output.

**Acceptance criteria:** `tool-registry.ts` (not yet modified in this step) *could* import `MESSAGES`/`notifyOperator` if it needed to; existing `processAutoResponse()` behavior is provably unchanged.

**Definition of Done:** merged alone; existing WhatsApp funnel behavior (Pipeline A/B, whichever is live) is bit-for-bit unchanged.

---

## Step 4 — Build `action-arguments.ts` (pure mapping layer)

**Status: ✅ COMPLETE — approved.** Implemented exactly within the approved scope of `PHASE_1B_STEP4_READINESS_REVIEW.md` and formally closed out; see `audit/PHASE_1B_STEP4_REPORT.md` (Step 4 Close-Out + Step 4 Design Corrections sections) for the full record — files created, 25 tests, risks in/out, rollback procedure, and five design corrections discovered while grounding the module against real function signatures and re-reading `orchestration-engine.ts`/`decision-table.ts` closely. Not wired anywhere — confirmed by grep, only its own test file imports it.

**Objective:** Implement the 13-action argument-building functions from the design doc's Section 6 table, fully unit-tested, called by nothing yet.

**Files to modify:** none.

**New files to create:**
- `src/lib/ai/action-arguments.ts` — one exported function per `OrchestrationAction` (or a single dispatch function plus 13 small internal ones — mirrors `tool-registry.ts`'s own one-entry-per-action style). Pure where possible: takes `OrchestrationSuccess` plus whatever minimal extra context an action needs (e.g. `notification_settings` lookup for `notify_staff` is I/O, so that one function is `async`; the rest can be sync).
- `src/lib/ai/action-arguments.test.ts`

**Existing files to remove:** none.

**Database changes:** none (some functions read `notification_settings` at call time — no schema change, existing table).

**API changes:** none.

**Feature flag requirements:** none — not wired into any live path yet.

**Unit tests:** one describe block per action (13 total) covering: correct argument shape for the happy path; the `generate_proposal` no-reservation-yet downgrade-to-`notify_staff` behavior (design doc Section 6.2); the `check_*_availability` partial-coverage behavior when venue can't be resolved to an inventory item id (design doc Section 11, item 1) — this function should return a clearly-typed "cannot build arguments, fall back to notify_staff" result rather than throwing, matching this codebase's existing safe-failure discipline (`inbound-guard.ts`, `tool-registry.ts`'s `getTool()`).

**Integration tests:** none required — pure functions, no I/O to integration-test beyond the one `notify_staff` lookup, which can be covered by a mocked-Supabase unit test instead.

**Regression tests:** N/A — new file, no existing behavior to protect. Confirm it doesn't accidentally import and thereby couple to anything that changes `slot-memory.ts`/`decision-table.ts`/`tool-registry.ts` behavior (import-only, read-only usage).

**Rollback procedure:** delete the two new files. No caller exists yet, so nothing else needs to change.

**Risks:** the `generate_proposal` and `check_*_availability` edge cases (Section 6.2 and Section 11 item 1 of the design doc) are the real design risk in this whole backlog — get the fallback behavior reviewed before Step 5 depends on it.

**Acceptance criteria:** 100% of the 13 actions have a tested argument-builder; both flagged edge cases have explicit tests proving the safe-fallback path, not just the happy path.

**Definition of Done:** merged alone, full test coverage, `tsc`/`lint`/`test`/`build` green, still not imported by any route.

---

## Step 5 — Build `orchestration-executor.ts`

**Status: ✅ COMPLETE.** Implemented exactly within the approved scope of `PHASE_1B_STEP5_READINESS_REVIEW.md`; see `audit/PHASE_1B_STEP5_REPORT.md` for the full record — files created, 11 tests, the Canonical Orchestration Result Contract documenting all four `action-arguments.ts` branches and each consumer's responsibility, and the explicit "unavailable" no-op preserved and recorded as an open Step 6 rollout decision (not resolved here, per instruction). Not wired anywhere — confirmed by grep, only its own test file imports it.

**Objective:** Implement the single new business-logic file this whole phase needs (design doc Section 4.2) — calls the right tool with the right arguments, normalizes the result, sends the reply, records it, runs post-reply handoff. Still not called from any route.

**Files to modify:** none.

**New files to create:**
- `src/lib/ai/orchestration-executor.ts` — exports `executeOrchestration(outcome: OrchestrationSuccess, ctx: ExecutorContext): Promise<ExecutorResult>`. `ExecutorContext` carries the channel-specific `send` function injected by the caller (keeps this file channel-agnostic per the design doc), `conversationId`, `channelId`, `leadId`.
- `src/lib/ai/orchestration-executor.test.ts`

**Existing files to remove:** none.

**Database changes:** none (uses Step 2's `orchestration_decisions` table and `unified_messages`/`recordMessage()`, both already existing by this point).

**API changes:** none — not called from any route yet.

**Feature flag requirements:** the function itself takes `mode: 'shadow' | 'active'` as an explicit argument rather than reading settings itself (keeps it a pure-ish, fully-mockable unit) — in `'shadow'` mode it writes to `orchestration_decisions` and returns without calling `sendWhatsAppText`/`recordMessage`/`checkAndApplyHandoff`; in `'active'` mode it does all of that. This split is itself unit-testable without any settings dependency.

**Unit tests:** mock every `tool.fn` (same `vi.mock()` hoisting discipline as `orchestration-engine.test.ts` — typed optional-parameter mock functions, never a bare reference inside the factory); one test per action confirming the right `action-arguments.ts` builder was invoked and the right normalized result comes back; shadow-mode test confirming no `send`/`recordMessage`/handoff side effect fires and an `orchestration_decisions` row is produced; active-mode test confirming all three do fire; a `SlotConflict`-present test confirming conflicts get written into the `orchestration_decisions.conflicts` column unchanged (Critical Issue 1's output finally has somewhere to land).

**Integration tests:** none required yet — this file's integration point (a real webhook request) is Step 6's job, not this one's. A same-process test using the real (non-mocked) `action-arguments.ts` plus mocked tool functions plus a real (test-database) `orchestration_decisions` insert is a reasonable middle-ground "integration-ish" test to include here.

**Regression tests:** N/A — new file, no live caller.

**Rollback procedure:** delete both new files.

**Risks:** the mock-hoisting mistake that regressed `orchestration-engine.test.ts` once already (documented in the Hardening Sprint work) is the concrete, known failure mode to guard against here from the start rather than discover later — write the mock factories using the already-proven-correct pattern from day one.

**Acceptance criteria:** every one of the 13 actions has a passing executor test; shadow vs. active behavior is provably distinct; conflicts pass through intact.

**Definition of Done:** merged alone, full coverage, still zero live callers, `tsc`/`lint`/`test`/`build` green.

---

## Step 6 — Wire the webhook route: shadow mode only, limited environment

**Status: ✓ Step 6 Complete — VERIFIED.** Delivered this session per an explicit, revised kickoff that superseded this section's original shadow-mode/allow-list staging (see below) with a single-step, flag-gated, active-mode wiring — the final Phase 1B engineering step. `src/app/api/whatsapp/webhook/route.ts` now branches on `settings.orchestration.enabled` (still default `false`); flag-off behavior is byte-identical to pre-Step-6. Verified locally by the user: `npm test` (41 files / 377 tests passed), `npm run lint` (passed — one pre-existing, unrelated warning), `npx tsc --noEmit` (passed, no errors). A one-line post-verification ESLint fix was applied to `src/lib/ai/orchestration-executor.ts` (an unresolvable `@typescript-eslint/no-explicit-any` disable-comment, since that plugin was never registered in this project's `.eslintrc.json` — no business logic changed). Full detail, deviations, and risks: `audit/PHASE_1B_STEP6_REPORT.md`.

**Important:** this implementation does not include the shadow-mode/test-number-allow-list staging this section originally specified (see below) — the approved Step 6 kickoff redefined Step 6 as a single global on/off flag with no staged rollout. This is a disclosed deviation, not an oversight — see the Step 6 report's "Deviations" section. Steps 7 and 8 below, as originally drafted, are therefore superseded/not applicable to what was actually built; a future step would need to be freshly scoped if staged rollout is wanted.

**Objective:** First time `orchestrate()` ever runs against real traffic. Computes and logs a decision on every real inbound WhatsApp message; changes nothing a customer can see.

**Files to modify:**
- `src/app/api/whatsapp/webhook/route.ts` — inside `handleIncomingMessage()`, after the existing `buildAutoReply()`/`sendWhatsAppText()`/`persistConversation()` calls (all untouched, still run first and unconditionally), add: read `settings.orchestration` via `getSettingsSection('orchestration')`; if `enabled && channels.includes('whatsapp')`, call `orchestrate()` with the already-available `aiContext`/identity data (reusing what `syncToUnifiedConversationPlatform()` already computes — no duplicate fetch) and pass the result plus `mode: 'shadow'` to `executeOrchestration()`. Wrapped in the same non-fatal try/catch pattern already used for `syncToUnifiedConversationPlatform()` — a failure here must never affect the reply already sent.

**New files to create:** none (all pieces built in Steps 1–5).

**Existing files to remove:** none.

**Database changes:** none new (uses Step 2's schema).

**API changes:** none externally — the webhook's request/response contract with Meta is unchanged. Internally, one new conditional code path.

**Feature flag requirements:** `settings.orchestration.enabled = true`, `mode = 'shadow'`, `channels = ['whatsapp']` — set only in a staging/limited environment for this step, via direct DB row (no UI yet, per Step 1). Production stays `enabled: false`.

**Unit tests:** webhook route test (new, if one doesn't exist, or extended) covering: flag off → `orchestrate()`/`executeOrchestration()` never called (mock and assert zero invocations); flag on, shadow mode → both existing reply path AND shadow orchestration path run, `sendWhatsAppText` called exactly once (proving no double-send).

**Integration tests:** send a realistic Meta webhook payload through the full route with the flag on in a test/staging config; assert (a) `orchestration_decisions` gets a row with the expected action, (b) the customer-visible reply is identical to what flag-off would have produced, (c) response time / route behavior otherwise unchanged (no new externally-visible latency budget blown — `maxDuration = 30` already set on this route, confirm the added orchestration computation stays well within it).

**Regression tests:** full existing webhook-route test suite (signature verification, rate limiting, status-update handling, `buildAutoReply` keyword paths) must stay green and untouched — this step only adds a branch, it doesn't touch any existing line.

**Rollback procedure:** set `settings.orchestration.enabled = false` (instant, no deploy needed) — first real test of the kill-switch. Full code rollback (revert the route change) is the second line of defense if the flag itself is insufficient for any reason.

**Risks:** the biggest new risk class in the whole backlog — this is the first time `orchestrate()` touches a real request. Mitigated by: shadow mode doing nothing observable, the try/catch isolation, and the flag defaulting off in every environment except the one explicitly configured for this test.

**Acceptance criteria:** over an agreed observation window in staging, `orchestration_decisions` rows are reviewed and judged reasonable against what actually happened; zero customer-visible discrepancies; zero errors surfaced from the new code path.

**Definition of Done:** observation window complete, decisions reviewed and signed off, flag still off in production, ready to consider Step 7.

---

## Step 7 — Enable active mode for a test-number allow-list

**Status: NOT BUILT — superseded.** Phase 1B's actual Step 6 (see above) went directly to a single active/inactive flag with no allow-list stage. This section is kept for historical record only.

**Objective:** First time this pipeline's decision is actually acted on for a real (but controlled) conversation.

**Files to modify:**
- `src/lib/settings/settings-service.ts` — add `testNumbers?: string[]` to `OrchestrationSettings` if not already added in Step 1 (recommend adding the field in Step 1 even though it's unused until now, to avoid a second schema-shape change).
- `src/app/api/whatsapp/webhook/route.ts` — the conditional from Step 6 now also checks `from` (the customer's phone) against `testNumbers` before choosing `mode: 'active'` vs `'shadow'` per-message; everyone not on the allow-list stays in shadow mode even with the master flag on.

**New files to create:** none.

**Existing files to remove:** none.

**Database changes:** none.

**API changes:** none externally.

**Feature flag requirements:** `enabled: true`, `mode` becomes per-message (`active` for allow-listed numbers, `shadow` for everyone else) rather than a single global mode — this is the one place the design doc's simple `mode: 'shadow'|'active'` needs a small refinement (per-number override), worth calling out explicitly during implementation review.

**Unit tests:** allow-list matching logic (a number on the list gets active mode; any other number gets shadow mode even with `enabled: true`).

**Integration tests:** using a small number of real, controlled WhatsApp test numbers, run full real conversations end to end (greeting → event type → date → guest count → qualified, plus a price-request mid-funnel, plus a complaint-triggered handoff) and manually verify each reply against what `auto-responder.ts`/Pipeline A would have said, confirming the new path's replies are at least as good and the funnel still reaches `QUALIFIED`.

**Regression tests:** everyone not on the allow-list must be provably unaffected — same regression suite as Step 6, plus a new explicit test that a non-allow-listed number gets shadow behavior even with the master flag on.

**Rollback procedure:** clear `testNumbers` (empties the allow-list, equivalent to shadow-only) or set `enabled: false` (full revert) — both instant, no deploy.

**Risks:** the `generate_proposal`→`notify_staff` downgrade (Section 6.2) and the venue/inventory resolution gap (Section 11 item 1) get their first real-world exercise here — treat any test-number conversation that hits either path as a required manual review item, not just a pass/fail.

**Acceptance criteria:** every test-number conversation reaches a sensible outcome; both flagged edge-case paths (if triggered during testing) behave as designed (graceful fallback, not an error or a broken reply).

**Definition of Done:** a documented, reviewed set of end-to-end test conversations, all judged acceptable, before considering Step 8.

---

## Step 8 — Enable active mode for 100% of WhatsApp

**Status: NOT BUILT — superseded.** Phase 1B's actual Step 6 (see above) already reaches 100% of WhatsApp traffic the moment the single flag is flipped on — there is no separate config-only step to reach full rollout. This section is kept for historical record only.

**Objective:** The new pipeline becomes the real, live reply path for every WhatsApp customer.

**Files to modify:**
- No code change from Step 7 required if the allow-list mechanism is simply widened — this step may be **config-only**: set `testNumbers` to match all numbers (or better, add an `allNumbers: boolean` escape hatch in `OrchestrationSettings` so this step doesn't require encoding "everyone" as an explicit list) and/or set the default per-message mode to `'active'`.

**New files to create:** none.

**Existing files to remove:** none yet — Pipeline A's code stays in the file, dead-when-flag-is-on, as the explicit one-release-cycle safety net the design doc calls for.

**Database changes:** none.

**API changes:** none.

**Feature flag requirements:** `enabled: true`, effectively `mode: 'active'` for all WhatsApp traffic. This is the flag configuration that matters most for the rollback plan below.

**Unit tests:** none new beyond Step 7's, unless the `allNumbers` escape hatch is added, in which case that gets its own small test.

**Integration tests:** production-traffic monitoring in place *before* flipping (error rates on the route, `orchestration_decisions` volume vs. inbound message volume, `ai_interaction_log` escalation rate) — treat the monitoring setup itself as a deliverable of this step, not an afterthought.

**Regression tests:** full existing suite, plus Steps 6–7's suites, all still green.

**Rollback procedure:** `settings.orchestration.enabled = false` — instant, no deploy, reverts every WhatsApp customer to Pipeline A's exact prior behavior, because that code path was never removed (only Step 9 touches it, and only as comments).

**Risks:** full production exposure. This is the step where a wrong `generate_proposal`/availability-resolution edge case reaches every customer instead of a controlled few — mitigated only by however clean Steps 6–7's observation windows were, and by the instant kill-switch.

**Acceptance criteria:** an agreed post-launch monitoring window (e.g. one full week) with no unresolved customer-impacting incident and an escalation/error rate no worse than Pipeline A's historical baseline.

**Definition of Done:** monitoring window complete, no rollback triggered, sign-off to consider Step 9.

---

## Step 9 — Deprecate the old pipelines (comment-only; physical removal is Phase 1C)

**Status: NOT BUILT — deferred.** Pipeline A (`buildAutoReply`/`persistConversation`, now `runLegacyReplyPath()`) is still fully live and is Phase 1B's own rollback path, so marking it dead would be premature — `settings.orchestration.enabled` is still `false` everywhere as of Phase 1B's close. This is a natural Phase 1C candidate once the flag has actually been exercised in production. This section is kept for historical record only.

**Objective:** Mark dead code dead, without deleting the safety net yet.

**Files to modify:**
- `src/app/api/whatsapp/webhook/route.ts` — add a header comment on `buildAutoReply()`/`persistConversation()` noting they are dead when `orchestration.enabled=true`, retained only as the Phase 1B rollback path, scheduled for removal in Phase 1C once Step 8's monitoring window has been stable for an agreed additional period.
- `src/services/whatsapp/process-inbound.ts` — add a header comment marking the file confirmed-unreachable-in-production and noting which of its capabilities were migrated where (idempotency semantics → Step 2's unique index; `qualifyLeadFromMessage`/`runAutoPackageRecommendation` → now called from the new path; `processAutoResponse`'s templates → exported and reused per Step 3).

**New files to create:** none.

**Existing files to remove:** **none in this step** — explicitly deferred to Phase 1C per the design doc's own Section 12, Step 9 description. This backlog step is comment-only.

**Database changes:** none.

**API changes:** none.

**Feature flag requirements:** none new.

**Unit tests:** none required (comment-only change) — but re-run the full suite to confirm a comment addition didn't somehow break anything (defensive, not because it's expected to).

**Integration tests:** none required.

**Regression tests:** full suite green, unchanged.

**Rollback procedure:** trivial — revert comments. There is no functional rollback needed since nothing functional changed.

**Risks:** none functional. The only real risk is organizational: someone reading `process-inbound.ts` without this comment might think it's live and modify it under a false assumption — this step exists specifically to prevent that.

**Acceptance criteria:** both files clearly documented as deprecated-not-deleted, with a pointer to where each capability now lives.

**Definition of Done:** merged; Phase 1B is functionally complete; physical removal is explicitly scoped to Phase 1C, not this backlog.

---

## The Safest Step 1

**Step 1 as scoped above — `OrchestrationSettings` config in `settings-service.ts` — is the correct starting point, and it satisfies all four of your requirements exactly:**

- **Infrastructure only:** it adds a typed config section and its default value. No function anywhere calls `getSettingsSection('orchestration')` yet — there is no reader, so there is nothing for this step to affect.
- **Preserves existing production behavior:** it requires zero database migration (the `settings` table's `category`/`key`/`value` shape already supports an arbitrary new `key` with no schema change) and zero changes to any of the other three existing sections' defaults or read/write paths — proven by the regression tests requiring `venue`/`ai`/`notifications`/`whatsapp` to round-trip identically.
- **Feature flag OFF by default:** `enabled: false` is the literal default value being added; there is no code path in this step that could even check it yet.
- **Independently testable and revertible:** one file changed, a self-contained unit test suite, and a revert that touches no data (no row needs to have ever been written to `settings` for `'orchestration'` for the revert to be clean).

This is also, not coincidentally, the step the design document itself already identified as first — this backlog confirms it holds up against your four explicit safety criteria and gives it full file-level detail. Recommend approving Step 1 alone; Steps 2–5 (also code/schema with no live caller) are the next-safest tier and can be sequenced right behind it once Step 1 is reviewed.

**Awaiting approval before implementing Step 1.**
