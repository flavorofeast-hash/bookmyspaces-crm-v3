# Phase 1B — Step 4 Implementation Report
**Build `action-arguments.ts` (pure argument-mapping layer)**

Baseline: Step 3 approved and closed out. Step 4 Readiness Review approved.

---

## Files Modified
None.

## Files Created
- `src/lib/ai/action-arguments.ts`
- `src/lib/ai/action-arguments.test.ts`

## Tests Added
25 total, one or more per action:
- `handoff_to_human`: real-`HandoffReason` happy path; safe-fail when decision-table fired without one (see Deviations/Discoveries below).
- `collect_missing_information`/`ask_question`: each of `eventType`/`eventDate`/`guestCount` resolving to the correct `MESSAGES` template; safe-fail when no slot is actually missing; `ask_question`'s only realistic path (also a safe-fail, since it's unreachable via `decision-table.ts` today).
- `check_room_availability`/`check_banquet_availability`: safe-fail with no `inventoryItemId`; correct `checkAvailability()` args when both an id and `eventDate` are known; safe-fail when `eventDate` alone is missing even with a resolved id; `check_banquet_availability` follows the identical rule.
- `generate_quotation`: confirms `getActivePackagePrices()` is called with zero arguments (see Discoveries).
- `recommend_package`: happy path with `leadId`+`conversationId`; safe-fail without a `leadId`.
- `generate_proposal`: always downgrades to `notify_staff`'s own result, both when that result succeeds and when it itself safe-fails.
- `create_lead`/`update_lead`: correct `CaptureLeadInput` shape, including the channel-derived `source` string and `sendWelcome: false`.
- `notify_staff`: correct `enqueueMessage` args with the `91`-prefixed operator number when `notification_settings` has one configured; safe-fail when it doesn't.
- `schedule_follow_up`: safe-fail without a caller-supplied `followUpMessage`; safe-fail without a customer phone; correct args when both are present.
- `answer_immediately`: correct `chatWithAI()` args — prior conversation history reshaped to `Message[]`, plus the current turn as `userQuery`.
- A dispatch-exhaustiveness test iterating all 13 `OrchestrationAction` values, confirming every one produces a result (never throws) tagged with the correct `action`.

## Lint Results
```
npx eslint src/lib/ai/action-arguments.ts src/lib/ai/action-arguments.test.ts → exit 0
npm run lint (full project) → exit 0
```

## TypeScript Results
```
npx tsc --noEmit (full project) → exit 0, zero errors
```

## Test Results
```
npx vitest run src/lib/ai/action-arguments.test.ts
 ✓ src/lib/ai/action-arguments.test.ts  (25 tests) 6-8ms
 Test Files  1 passed (1)
      Tests  25 passed (25)
```
Full 38-file suite: attempted in-sandbox multiple times; consistent with every prior full-suite attempt in this project, it did not finish within this sandbox's per-command time limit. One concrete, useful finding from this attempt: the first version of `action-arguments.test.ts` imported `getTool` from `tool-registry.ts` purely to populate an unused field in a test fixture, which transitively pulled in `create-lead-with-journey.ts` → `sheets.ts` → `googleapis` — the same slow dependency chain documented elsewhere in this project as a source of sandbox timeouts for `tsc`/`eslint`/`next build`. Removing that one import (replacing it with a trivial typed stand-in, since `action-arguments.ts` itself never reads the `.tool` field) brought this test file's own run time down from a timeout to 31s. `action-arguments.ts` itself has no such heavy dependency — confirmed by its own import list (only `@/lib/supabase` and the now-exported `auto-responder.ts` `MESSAGES`, plus type-only imports elsewhere, which are erased at build time). Individually confirmed passing in this session: `action-arguments.test.ts` (25/25), `auto-responder.test.ts` (16/16), `settings-service.test.ts` (13/13), `orchestration-engine.test.ts` (18/18) — the four files most relevant to this step and its dependencies. The authoritative 38/38-plus-25 count still needs a local `npm test` run.

## Risks Introduced
- **None beyond Steps 1–3's baseline.** Confirmed by grep: the only importer of `action-arguments.ts` anywhere in `src/` is its own test file. No new live code path exists for any defect in this module to reach.

## Risks Eliminated
- None new this step — Step 4 is additive infrastructure with no prior gap of its own to close (unlike Step 3, which closed the `tool-registry.ts` `knownGap` blockers). It does, however, make the design doc's Section 6 mapping table concrete and tested rather than descriptive prose, which is real groundwork for Step 5 to build on safely.

## Rollback Procedure
Delete `src/lib/ai/action-arguments.ts` and `src/lib/ai/action-arguments.test.ts`. No caller exists, no data involved — a two-file deletion fully reverts this step.

---

## Explicit Confirmations

- **Feature flag unchanged.** `settings-service.ts` was not touched in this step; `orchestration.enabled` remains `false`.
- **No live route wiring.** No route, webhook, or scheduled job was modified.
- **No runtime orchestration activation.** `action-arguments.ts` is not imported by `orchestration-engine.ts`, any route, or `process-inbound.ts` — confirmed by grep.
- **No customer-visible behavior.** Nothing in this step can execute against a live request; there is no code path from any real request to this module.
- **Independently deployable.** Two new, self-contained files; no dependency on Step 2's (still-unapplied) migration or on anything beyond Steps 1–3 already being merged.
- **Independently reversible.** Two-file deletion, no data involved.

## Deviations from the Approved Design

**Not "None" — three factual corrections discovered while grounding the module against real code, all within the spirit of the approved review, none expanding scope:**

1. **`getActivePackagePrices()` takes zero arguments**, not `(guestCount, eventType)` filter criteria as the original design doc's Section 6 table assumed. Confirmed against `src/lib/pricing/pricing-service.ts` directly. `generate_quotation`'s builder calls it with `args: []`. This is a correction to a prior document's assumption, not a scope change to Step 4 itself.
2. **`OrchestrationSuccess` does not carry the original customer message.** `orchestration-engine.ts`'s `orchestrate()` returns `aiContext`, `slots`, `intent`, `handoffReason`, `decision`, and `tool` — the verbatim input message is not among them. `answer_immediately`'s builder needs it (as `chatWithAI()`'s `userQuery` argument), so `ActionArgumentsContext` gained a required `message: string` field, documented as caller-supplied because the caller (whoever calls `orchestrate()`) already has it and this module must not guess or re-derive it. This was not called out in the readiness review's mapping table (which listed `aiContext`/`message` together as if both came from the same source) — a factual gap in that table, corrected here, not a scope expansion.
3. **A genuine new design gap in `handoff_to_human`**, not previously identified: `decision-table.ts`'s Rules 2 and 3 can produce `action: 'handoff_to_human'` without setting `handoffReason` (Rule 2: confidence below threshold; Rule 3: conversation already escalated) — but `applyHandoff()` requires a real `HandoffReason` literal, and neither rule's trigger corresponds to one. (In practice, `orchestrate()`'s current wiring always passes `confidence: 1`, so Rule 2 cannot fire through this pipeline today — only Rule 3 can.) Per this step's explicit instruction to safe-fail rather than solve underlying design gaps, `buildHandoffToHumanArgs()` returns an `unavailable` result in this case instead of inventing a `HandoffReason` value. This is a new finding, surfaced by building this module, not a deviation from what was approved — the readiness review's own risk section anticipated exactly this category of discovery ("if Step 4's implementation quietly guesses instead of failing safe... that would reintroduce exactly the... failure mode Hardening Sprint High Issue 2 already fixed once").

No other deviation occurred. The two explicitly-required safe-fail/downgrade behaviors (`check_*_availability`'s missing inventory id, `generate_proposal`'s missing reservation) are implemented exactly as specified, with dedicated tests for each.

## Known Follow-up Items (carried forward, unchanged by Step 4)

Same as Steps 2–3's close-outs, still open, still not blocking Step 5: the unpatched `next@14.2.5` CVE cluster, the two secret-management findings, the `MASTER_ENGINEERING_SPECIFICATION.md` discrepancy, and the design doc's five open questions — plus, new to this list, item 3 above (the `handoff_to_human` / Rule 2-3 `HandoffReason` gap) as a design question for whoever revisits `decision-table.ts` or `orchestrator.ts`'s `HandoffReason` union next.

**Step 4 complete. Stopping here per instruction — awaiting approval before Step 5.**

---

## Step 4 Close-Out

**Status: ✅ COMPLETE (approved).**

### Files Modified
None.

### Files Created
- `src/lib/ai/action-arguments.ts`
- `src/lib/ai/action-arguments.test.ts`

### Tests Added
25 (see the full breakdown above under "Tests Added").

### Risks Introduced
None beyond Steps 1–3's baseline — no live caller exists.

### Risks Eliminated
None new this step (see above) — Step 4 is groundwork, not a fix to a prior gap.

### Rollback Procedure
Delete both new files. No caller, no data involved.

## Step 4 Design Corrections

Five corrections surfaced while building this module against the real codebase rather than the design doc's prose description of it. Each is recorded here with why it was necessary — none were optional polish; each would have produced a builder that either couldn't compile against the real function it targets, or would have silently guessed at data this module has an explicit mandate never to guess.

### 1. Corrected function signature: `getActivePackagePrices()`
**What:** The design doc's Section 6 mapping table assumed `generate_quotation`'s tool, `getActivePackagePrices()`, took `(guestCount, eventType)` filter arguments. The real function, in `src/lib/pricing/pricing-service.ts`, takes **zero arguments** — it queries all active packages unconditionally.
**Why necessary:** Building the `generate_quotation` argument-builder required reading the actual function signature; had it been implemented against the design doc's assumption instead, the builder would have produced an `args` array (`[guestCount, eventType]`) that doesn't match the real function's parameter list at all — a defect that unit tests (which check the builder's own output, not a live call) would only catch if written against the correct signature in the first place. Corrected by reading the source directly before writing the builder or its test.

### 2. Required `message` field added to `ActionArgumentsContext`
**What:** `OrchestrationSuccess` (the return type of `orchestrate()`) carries `aiContext`, `slots`, `intent`, `handoffReason`, `decision`, and `tool` — but not the customer's original message text. `answer_immediately`'s builder needs that exact text as `chatWithAI()`'s `userQuery` argument.
**Why necessary:** Without this field, the builder would have had to either fabricate a query string from `aiContext.conversationHistory` (guessing which entry represents "the current turn," which is not reliably knowable from history alone) or silently produce an incorrect/empty argument. Neither is acceptable under this module's "never guess" mandate. The fix: `ActionArgumentsContext.message: string` is now a required, caller-supplied field — the caller already has this value (it's what it passed into `orchestrate()` originally), so requiring it here is a correct dependency, not a workaround.

### 3. `handoff_to_human` now requires (and can be missing) a real `HandoffReason`
**What:** `applyHandoff()` (`orchestrator.ts`) requires `reason: HandoffReason`, a closed union (`customer_requested_human | complaint | refund_request | payment_issue | low_confidence`). But `decision-table.ts`'s Rule 2 (confidence below threshold) and Rule 3 (conversation already in `HANDOFF_TO_OPERATOR`) can both produce `action: 'handoff_to_human'` while leaving `handoffReason` `null` — neither rule's trigger maps to an existing `HandoffReason` literal.
**Why necessary:** In practice, `orchestrate()` always calls `decideNextAction()` with `confidence: 1` (its own documented "neutral, no reply yet" convention), so Rule 2 cannot fire through this pipeline as currently wired — but Rule 3 can, any time a conversation is already escalated. Building `handoff_to_human`'s argument builder required deciding what to do in that case; inventing a plausible-sounding `HandoffReason` (e.g., reusing `'low_confidence'` for an unrelated trigger) would have corrupted `ai_interaction_log.escalation_reason`, an audit trail. The builder instead safe-fails (`kind: 'unavailable'`) with a reason string naming the actual gap. This is a genuine, newly-surfaced design question (not resolved by Step 4 — see Known Follow-up Items) for whoever next revisits `decision-table.ts` or the `HandoffReason` union.

### 4. Inventory-item resolution limitation (`check_room_availability` / `check_banquet_availability`)
**What:** `checkAvailability()` requires a real `inventoryItemId`. Nothing available to this module — not `SlotValues` (whose `venue` field is free text), not `AIContext` (`CustomerPreferences.preferredVenue` is also free text) — carries a resolved inventory item id.
**Why necessary:** This was already identified as an open question before Step 4 (design doc Section 11, item 1) and was an explicit, approved requirement for this step: never guess an id. Re-confirmed by directly inspecting every field on `SlotValues` and `AIContext` while building the builder, not assumed from the earlier review alone. The builder accepts an optional, caller-supplied `inventoryItemId` and safe-fails whenever it's absent — which, given no resolver exists anywhere in this codebase today, means it will safe-fail on every real call until a future step adds one. That is the intended, approved behavior for Step 4, not a defect.

### 5. `generate_proposal` downgrade behavior
**What:** `createProposalFromReservation()` requires a `reservationId`. Nothing in the pipeline up to and including `decideNextAction()` returning `generate_proposal` has created a reservation.
**Why necessary:** Already decided in the design doc (Section 6.2) before Step 4 began — not a new discovery, but recorded here for completeness since it's one of the two explicitly-required interim behaviors. The builder never attempts the real proposal call; it always returns a `kind: 'downgraded'` result pointing at `notify_staff`'s own output (itself potentially a safe-fail, if no operator number is configured — tested explicitly). This keeps the interim behavior honest: a `generate_proposal` decision always results in either a staff notification or a clear failure reason, never a call to a function missing a required argument.
