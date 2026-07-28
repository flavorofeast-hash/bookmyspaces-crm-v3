# Phase 1B — Step 3 Readiness Review
**Export `auto-responder.ts` templates + `notifyOperator()`**

Baseline: Step 2 provisionally accepted (`audit/PHASE_1B_STEP2_REPORT.md` close-out). Step 1 (`fa7df34`) and Step 2 both merged; orchestration flag still `false`, still unread by any code.

Status: **review only — no code has been written for Step 3.**

Re-verified against the current repo state before writing this review:
- `src/lib/whatsapp/auto-responder.ts` re-read in full — `MESSAGES` (module-private `const`) and `notifyOperator()` (module-private `function`) are exactly as described in the original design doc: not exported, referenced only within this file's own `processAutoResponse()`.
- No test file exists for this module today — `src/lib/whatsapp/auto-responder.test.ts` does not exist (confirmed by grep across `src/`). This changes one item from the original backlog: Step 3's unit test file is a **new file**, not an extension of an existing one.
- `GREETING` currently does double duty — it both welcomes the customer and asks "what type of event," so there is genuinely no dedicated `ASK_EVENT_TYPE` template to export as-is; one needs to be added (net-new text, not a refactor of existing text) for the future `collect_missing_information` tool (Step 5) to be able to ask for `eventType` specifically without re-greeting a returning customer. This is called out explicitly below since it's the one place this step adds new content rather than only changing visibility.

---

## 1. Objectives of Step 3

Turn two already-correct, already-live pieces of logic into reusable exports, with zero change to `processAutoResponse()`'s existing behavior:
- `export` the `MESSAGES` object (or the subset needed) so a future tool-registry entry (Step 5+) can reuse the exact same customer-facing copy instead of duplicating it.
- `export` `notifyOperator()` so a future `notify_staff` tool implementation (Step 5+) can reuse the exact same operator-alert logic instead of duplicating it.
- Add one new template, `ASK_EVENT_TYPE`, cleanly separating "ask what type of event" from "greet the customer" — needed because `GREETING` conflates both today and a future caller may need to ask for `eventType` alone (e.g. a returning customer whose slot memory shows every slot filled except `eventType`).

## 2. Architectural Impact

Minimal and additive. This is a visibility change (`const` → `export const`, `function` → `export function`) plus one new template string. `processAutoResponse()`'s own control flow, `advanceConversationState()` calls, and every `leads`/`activity_logs` write it performs are untouched — this step does not touch a single line of that function's body.

## 3. Files to Modify

- `src/lib/whatsapp/auto-responder.ts` — add `export` to `MESSAGES` and `notifyOperator`; add `ASK_EVENT_TYPE` to the `MESSAGES` object.

No other file. In particular, **`decision-table.ts` and `tool-registry.ts` are not touched by Step 3** — wiring `MESSAGES`/`notifyOperator` into `ask_question`/`collect_missing_information`/`notify_staff`'s registry entries is Step 5's job (`action-arguments.ts`) and Step 4/5's, not this one's. Step 3 only makes the export exist; nothing consumes it yet.

## 4. New Files to Create

- `src/lib/whatsapp/auto-responder.test.ts` — does not exist today (confirmed above), so this is a new file, not an extension, correcting the original backlog's "extend if one exists; create if not" language now that it's known which applies.

## 5. Files That Must NOT Be Modified

Everything except `auto-responder.ts` (and the new test file). Explicitly: `process-inbound.ts` (which calls `processAutoResponse()` today but is itself still unwired to any live route — untouched), the WhatsApp webhook route, `orchestrate()` and every `src/lib/ai/` Phase 1A.1 file, `decision-table.ts`, `tool-registry.ts`, `unified-conversation-service.ts`, `settings-service.ts`, the Step 2 migration files, `package.json`.

## 6. Runtime Behavior Changes

None for any existing caller. `processAutoResponse()` (the one live consumer of `MESSAGES`/`notifyOperator` today, reachable only via `process-inbound.ts`, which is itself still not called from any route — confirmed again during the Step 2 investigation) continues to reference `MESSAGES.GREETING`, `MESSAGES.ASK_EVENT_DATE`, etc. exactly as it does now; adding `export` in front of a declaration does not change what that declaration evaluates to. `ASK_EVENT_TYPE` is a new, unused-by-existing-code template — nothing reads it yet, so its addition cannot change any existing output.

## 7. Feature Flag Usage

None. Still not consulted anywhere. This step doesn't add a reader for `settings.orchestration`, and doesn't need one — it's a pure export/content change.

## 8. Unit Tests Required

New file `auto-responder.test.ts`:
- Snapshot/exact-string assertions for every existing template (`GREETING`, `ASK_EVENT_DATE`, `ASK_GUEST_COUNT`, `QUALIFIED`, `HANDOFF`, `ALREADY_QUALIFIED`, `UNRECOGNISED_DATE`) — proves the export change didn't alter any customer-facing copy.
- A test for the new `ASK_EVENT_TYPE` template's exact text (author it once, pin it with a test immediately, matching this repo's practice elsewhere of pinning literal copy).
- `notifyOperator` is exported and callable with its existing signature (can be a type-level/compile check plus a mocked-Supabase unit test mirroring the existing `notification_settings` lookup behavior, same mocking style as `settings-service.test.ts`).
- A regression assertion that `processAutoResponse()`'s existing behavior (state transitions, `leads` writes, `advanceConversationState()` calls) is unaffected — confirmed via grep that **no test file references `auto-responder` anywhere in `src/` today**, so `processAutoResponse()` itself has zero existing test coverage to protect. This step should not be the one to backfill that (out of Step 3's stated scope — it's about exports, not `processAutoResponse()`'s own correctness); flagged as a pre-existing gap for whoever plans a dedicated pass on that function, not a Step 3 requirement.

## 9. Integration Tests Required

None. No I/O path changes, no new database interaction beyond what `notifyOperator()` already does (reading `notification_settings`), which is unchanged.

## 10. Rollback Strategy

Revert `auto-responder.ts` to its Step-2 (pre-Step-3) content and delete the new test file. No data involved, no migration to undo — trivial, single-file (plus one new test file) revert.

## 11. Risks

- **Near zero.** The only real risk is accidentally changing template *content* while adding `export` — the exact-string unit tests exist specifically to catch that.
- **Naming ambiguity risk (design-level, not code-level):** once `ASK_EVENT_TYPE` exists as a distinct template from `GREETING`, a future step (5+) has to decide whether `GREETING` still also asks for event type on a brand-new conversation (today's behavior) or switches to greeting-only with `ASK_EVENT_TYPE` following separately. Step 3 does not need to resolve this — it only needs to make both templates available — but it's worth flagging now so Step 5's action-arguments mapping doesn't quietly duplicate the event-type question on a new conversation.

## 12. Acceptance Criteria

- `MESSAGES` and `notifyOperator` are importable from outside `auto-responder.ts`.
- Every pre-existing template's text is byte-identical to before this change (proven by tests, not assumed).
- `ASK_EVENT_TYPE` exists, has approved copy, and is pinned by a test.
- `processAutoResponse()` is provably unaffected — same inputs produce the same outputs, same state transitions, same DB writes.

## 13. Definition of Done

Merged alone; `tsc --noEmit`, `npm run lint`, `npm test` all green; zero other files changed; `MESSAGES`/`notifyOperator` remain unconsumed by anything outside `auto-responder.ts` itself until Step 5.

---

## Explicit Verification Against Your Four Standing Criteria

- **Independently deployable:** yes — one file changed, one new test file, no dependency on Step 2's (not-yet-applied) migration or on anything beyond Step 1/2 already being merged.
- **Independently reversible:** yes — single-file revert, no data involved.
- **Feature flag OFF by default:** unaffected — Step 3 doesn't touch it.
- **No customer-visible changes unless explicitly approved:** true, with the same caveat pattern as before stated plainly: `processAutoResponse()` is reachable today only through `process-inbound.ts`, which remains unwired from any live route (re-confirmed during Step 2's investigation, not newly assumed here) — so even the theoretical case of "what if `processAutoResponse()`'s behavior changed" has zero live blast radius regardless. The actual change (export keywords + one new unused template) cannot affect any existing behavior at all, wired or not.

**Recommendation:** proceed to implement Step 3 whenever approved. This is the lowest-risk step in the backlog so far — lower than Step 2, on par with Step 1.

**Awaiting approval before implementation.**
