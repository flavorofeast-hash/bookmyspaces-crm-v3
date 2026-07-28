# Phase 1B — Step 4 Readiness Review
**Build `action-arguments.ts` (pure argument-mapping layer)**

Baseline: Step 3 approved and closed out (`audit/PHASE_1B_STEP3_REPORT.md`). Steps 1–3 all merged. Feature flag `settings.orchestration.enabled` remains `false`, unread by any code. `orchestrate()` remains completely unwired from every channel adapter.

Status: **review only — no code has been written for Step 4.**

Re-verified against the current repo state before writing this review: `src/lib/ai/action-arguments.ts` and any test file for it do not exist yet (confirmed by glob). `tool-registry.ts`, `decision-table.ts`, `orchestration-engine.ts`, and `auto-responder.ts` (now with `MESSAGES`/`notifyOperator` exported per Step 3) are all unchanged since their respective last reviews.

---

## Objectives

Implement the 13-action argument-building layer described in `audit/PHASE_1B_DESIGN_DOCUMENT.md` Section 6 and scoped in `audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md`'s Step 4: for each `OrchestrationAction` `decideNextAction()` (`decision-table.ts`) can produce, a small, individually-testable function that builds the real arguments the corresponding `tool-registry.ts` entry's function (`tool.fn`) actually needs to be called with. This is pure mapping logic — no execution, no I/O beyond the one lookup `notify_staff`'s builder needs, no decision-making of its own. It exists so a later step (5, the Executor) has something to call instead of hand-rolling argument construction inline.

Step 4 does not wire this layer into anything. Nothing in `src/` will import `action-arguments.ts` by the end of this step.

## Architecture

One new module, `src/lib/ai/action-arguments.ts`, following the same pure-function discipline already established by `slot-memory.ts` and `decision-table.ts` in this codebase: no Supabase import at the top level beyond what one specific builder needs, explicit return types, safe-fail-not-throw on missing preconditions (matching `inbound-guard.ts`'s and `tool-registry.ts`'s `getTool()`'s established "structured result, not a throw" convention).

Recommended shape: one exported function per action (13 total) plus a single dispatch function, rather than one large switch — mirrors `tool-registry.ts`'s own one-entry-per-action style so each builder is independently reviewable and testable:

| Action | Builder reads from | Notes |
|---|---|---|
| `handoff_to_human` | `OrchestrationSuccess.handoffReason`, caller-supplied `conversationId`/`leadId` | Straightforward — `applyHandoff()`'s existing signature already matches what's available. |
| `collect_missing_information` / `ask_question` | `slots.missingSlots[0]`, mapped to the matching `MESSAGES` template (`auto-responder.ts`, now exported per Step 3) | First real consumer of Step 3's exports. No `eventType`-specific ask exists in `processAutoResponse()`'s own flow today, but `MESSAGES.ASK_EVENT_TYPE` (Step 3) now covers it for this builder's use. |
| `check_room_availability` / `check_banquet_availability` | `slots.slots.eventDate`, `slots.slots.guestCount`, an inventory item id | **Known incomplete mapping** — no inventory item id is resolvable from slot memory alone today (design doc Section 11, item 1, still open). This builder must return a "cannot build arguments" result rather than guessing, per the safe-fail convention above. |
| `generate_quotation` | `slots.slots.guestCount`, `slots.slots.eventType` | Matches `getActivePackagePrices()`'s existing filter-criteria shape. |
| `recommend_package` | `leadId` only | `runAutoPackageRecommendation()` is already self-contained. |
| `generate_proposal` | would need a `reservationId` | **Known gap, already decided (design doc Section 6.2):** no reservation exists at this point in the pipeline. This builder downgrades to the `notify_staff` builder's output instead of attempting `createProposalFromReservation()`, with a clear reason string. This is the one action whose builder doesn't call its own registry-mapped tool — a deliberate, documented exception, not an oversight. |
| `create_lead` / `update_lead` | `slots.slots`, `leadId`/phone/channel identity | Matches `captureLeadWithJourney()`'s existing input shape. |
| `schedule_follow_up` / `notify_staff` | recipient + message text; `notify_staff` additionally reads `notification_settings.daily_summary_whatsapp` (same lookup `notifyOperator()` already performs) | `notify_staff`'s builder is the one async builder with real I/O (a `SELECT` against an existing table) — everything else in this module can be synchronous. |
| `answer_immediately` | `aiContext`, `message` | Already the right shape — `chatWithAI()`'s existing call pattern, no transformation needed. |

## Runtime Impact

None. Nothing in `src/` imports `action-arguments.ts` by design — this step produces a library of functions with zero callers, exactly like `orchestration-engine.ts` itself sat unwired for the entirety of Phase 1A.1 and Steps 1–3 of Phase 1B. No existing file's behavior can change, because no existing file is modified.

## Files to Modify

None.

## New Files to Create

- `src/lib/ai/action-arguments.ts`
- `src/lib/ai/action-arguments.test.ts`

## Files That Must NOT Be Modified

Everything else, explicitly re-stated: `decision-table.ts`, `tool-registry.ts`, `orchestration-engine.ts`, `inbound-guard.ts`, `slot-memory.ts`, `intent-detector.ts`, `context-builder.ts`, `auto-responder.ts` (Step 3's exports are read-only inputs to this step, not touched further), `unified-conversation-service.ts`, the WhatsApp webhook route, `process-inbound.ts`, `settings-service.ts`, any migration file, `package.json`.

## Tests Required

**Unit tests only** (no integration tests needed — pure functions, and the one real I/O call, `notify_staff`'s `notification_settings` lookup, is unit-testable with a mocked Supabase client exactly like `settings-service.test.ts`/`auto-responder.test.ts` already do):

- One describe block per action (13 total), each covering the happy-path argument shape.
- `generate_proposal`: an explicit test proving the downgrade-to-`notify_staff` behavior fires whenever no reservation is available — this is the one action whose "happy path" is itself the fallback.
- `check_room_availability`/`check_banquet_availability`: an explicit test proving the builder returns a structured "cannot build arguments" result (not a throw, not a guess) when no inventory item id can be resolved — mirrors `inbound-guard.ts`'s safe-fail convention.
- A dispatch-function test confirming every one of the 13 `OrchestrationAction` values routes to its correct builder (an exhaustiveness check, in the same spirit as `tool-registry.ts`'s `satisfies Record<OrchestrationAction, ...>` compile-time guarantee — this module should consider the same pattern if its dispatch is a plain object map).

## Risks

- **The two known-incomplete mappings** (`check_*_availability`'s missing inventory-item resolution, `generate_proposal`'s missing reservation) are the real design risk carried into this step from the design doc's own Section 11 — Step 4 does not solve either, it only encodes the agreed interim behavior (safe-fail / downgrade) so a later step doesn't have to rediscover the gap. If Step 4's implementation quietly guesses instead of failing safe or downgrading, that would reintroduce exactly the "acting on incomplete information" failure mode Hardening Sprint High Issue 2 already fixed once in `decision-table.ts` — worth flagging to whoever implements this as the one place to be careful, not just fast.
- Otherwise: **low.** No I/O beyond one existing table read, no new caller anywhere, no schema change, no flag interaction.

## Rollback

Delete the two new files. No caller exists yet, so nothing else needs to change. No data involved.

## Acceptance Criteria

- All 13 actions have a tested argument-builder (or, for `generate_proposal`, a tested downgrade path).
- Both known-incomplete mappings have explicit tests proving their safe-fail/downgrade behavior, not just a happy-path test.
- `tsc --noEmit`, `npm run lint`, `npm test` all green.
- Confirmed via grep: zero files outside `action-arguments.ts`/`action-arguments.test.ts` reference the new module.

## Definition of Done

Merged alone, full test coverage per above, still zero live callers, ready for Step 5 (the Executor) to be the first real consumer.

## Production Blast Radius Assessment

**Zero.** This step adds a library module with no import anywhere in the running application. There is no route, no cron job, no webhook, no scheduled task, and no UI component that could reach this code in Step 4's delivered state — the only way to exercise it at all is `action-arguments.test.ts` calling it directly in the test runner. A defect in this step's logic (e.g., a wrong argument shape for one action) would be caught by its own unit tests or, failing that, would only manifest once Step 5 wires a caller to it — which itself would then need its own separate approval before going anywhere near a live route. Applying Step 4 to production carries the same blast radius as not applying it at all.

---

## Explicit Confirmations

- **Feature flag remains OFF.** Step 4 does not read, write, or reference `settings.orchestration` anywhere.
- **No live route activation occurs in Step 4.** No route, webhook, or scheduled job is modified or gains a new import.
- **Customer-visible behavior remains unchanged unless explicitly approved.** Nothing in this step can affect any customer-visible behavior — there is no code path from any real request to `action-arguments.ts` as of this step's delivered state.

**Awaiting approval before implementation. Step 4 will not begin without it.**
