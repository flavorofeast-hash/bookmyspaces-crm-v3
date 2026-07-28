# Phase 1B — Step 5 Readiness Review
**Build `orchestration-executor.ts`**

Baseline: Step 4 approved and closed out (`audit/PHASE_1B_STEP4_REPORT.md`). Steps 1–4 all merged. Feature flag `settings.orchestration.enabled` remains `false`, unread by any code. `orchestrate()` remains completely unwired from every channel adapter. `action-arguments.ts` has exactly one importer (its own test file).

Status: **review only — no code has been written for Step 5.**

---

## Objectives

Build the one genuinely new business-logic file this entire phase requires (design doc Section 4.2, explicitly the piece Phase 1A.1 left out on purpose: `orchestration-engine.ts`'s own header states "it never calls that function — executing the chosen tool is left entirely to the caller"). `orchestration-executor.ts` is that caller. Given an `OrchestrationSuccess` (from `orchestrate()`) and enough context to act, it must:

1. Call `buildActionArguments()` (Step 4) to get an `ActionArgumentsResult`.
2. Branch on that result's `kind` and actually do the corresponding thing — call a real tool function, send an existing template reply directly, follow a `downgraded` redirect, or record that nothing could be done.
3. Normalize every outcome into one small `ExecutorResult` shape so a future caller (Step 6's webhook wiring) doesn't need to branch on 13 different action types itself.
4. In `mode: 'shadow'`: write one row to `orchestration_decisions` (Step 2's table) and take no other action — no send, no `recordMessage`, no handoff check.
5. In `mode: 'active'`: additionally send the reply (if any), record it via `recordMessage()`, and run `checkAndApplyHandoff()` (existing, `orchestrator.ts`) after any AI-generated reply.

Step 5 does not wire this into the webhook, `process-inbound.ts`, or any other route. That is Step 6's job.

## Architecture

New file, `src/lib/ai/orchestration-executor.ts`, exporting one function:
```
executeOrchestration(outcome: OrchestrationSuccess, ctx: ExecutorContext): Promise<ExecutorResult>
```

`ExecutorContext` needs to carry: `mode: 'shadow' | 'active'` (explicit parameter, not read from settings — matches the original design doc's own reasoning: keeps this function fully unit-testable without a settings dependency), `channel`, `conversationId`, `message` (the same field Step 4 added to `ActionArgumentsContext` — this file passes it straight through, it does not re-derive it), `inventoryItemId`/`followUpMessage` (passed straight through to `buildActionArguments()`), and an injected `send` function (channel-specific — e.g. `sendWhatsAppText` — injected by the caller rather than imported directly, so this file stays channel-agnostic for a future Website Chat wiring, per the original design doc's Section 4.2).

`ExecutorResult` normalizes every branch to `{ replyText: string | null; sideEffectsApplied: string[] }` (or a richer shape decided during implementation) — the same normalization idea the original design doc proposed, now made concrete against `action-arguments.ts`'s actual four-way `kind` union rather than the doc's simpler original assumption of one flat "args to spread into tool.fn" shape.

**The four-way branch, mapped explicitly to what exists today:**

| `ActionArgumentsResult.kind` | Executor behavior |
|---|---|
| `tool_call` | Look up the real function via `getTool(result.action)` (`tool-registry.ts`) and call `tool.fn(...result.args)`. Wrap in try/catch — none of `tool.fn`'s underlying functions are guaranteed not to throw or return an error shape, and this is the first place in the whole Phase 1A.1/1B pipeline that would actually invoke one of them from this code path. |
| `template_reply` | No tool call — `result.replyText` **is** the reply. This is `ask_question`/`collect_missing_information`'s path. |
| `unavailable` | No reply can be produced from this pipeline today. **Open design question, not resolved by this review** — see Risks/Dependencies below. |
| `downgraded` | Recurse into `result.result` (itself one of the four kinds) rather than re-deciding anything — today this is always `generate_proposal → notify_staff`. |

## Runtime Impact

**None, if Step 5 is implemented as scoped.** `orchestration-executor.ts` will be a new file with exactly one importer: its own test file — the same pattern every prior step in this backlog has held to. No existing file is modified. No route gains a new import.

## Files

**New:**
- `src/lib/ai/orchestration-executor.ts`
- `src/lib/ai/orchestration-executor.test.ts`

**Modified:** none.

**Must NOT be modified:** everything else, explicitly re-stated: the WhatsApp webhook route, `process-inbound.ts`, `unified-conversation-service.ts`, `decision-table.ts`, `tool-registry.ts`, `orchestration-engine.ts`, `action-arguments.ts` (Step 4's file — read-only input to this step, not touched further), `auto-responder.ts`, `settings-service.ts`, any migration file, `package.json`.

## Tests Required

Per the original backlog's Step 5 scope, refined against `action-arguments.ts`'s real shape:
- One test per `OrchestrationAction` (13) confirming the Executor calls the right thing: for `tool_call` results, that `tool.fn` was invoked with exactly `result.args` (mocked, same `vi.mock()` hoisting discipline already proven safe in `orchestration-engine.test.ts`); for `template_reply` results (`ask_question`/`collect_missing_information`), that the template text is sent as-is with no tool call; for the `generate_proposal` case, that the `downgraded` branch correctly recurses into its `notify_staff` sub-result.
- Shadow-mode test: confirms `send`/`recordMessage`/`checkAndApplyHandoff` are never called, and exactly one `orchestration_decisions` row is written (mocked Supabase insert), for a representative sample of actions (not necessarily all 13 — the shadow/active branch is orthogonal to which action fired).
- Active-mode test: confirms all three do fire, in the right order, for at least one `tool_call` action and the `template_reply` case.
- A `SlotConflict`-present test: when `outcome.slots.hasConflicts` is true, the conflicts array is written into `orchestration_decisions.conflicts` unchanged — this is the first place in the entire Phase 1A.1/1B effort that Critical Issue 1's conflict output actually lands anywhere durable.
- An `unavailable`-kind test: whatever the implementation decides to do when no reply can be produced (see the open question below) needs its own explicit test once that decision is made — flagged here so it isn't accidentally left untested.
- A tool-call-throws test: `tool.fn` rejecting or throwing should not crash the Executor — it should degrade to a safe, structured result (matching this codebase's established "safe failure, structured error" convention from `inbound-guard.ts` and `tool-registry.ts`'s `getTool()`).

**Integration tests:** none required — same reasoning as Step 4 (no live route reachable yet); a same-process test using the real `action-arguments.ts` with only the underlying tool functions mocked is a reasonable middle tier, consistent with what the original design doc suggested for this step.

## Rollback

Delete both new files. No caller exists (Step 5, like Steps 1–4, is not wired to anything live), no data involved.

## Risks

- **The `unavailable` branch has no decided behavior yet.** This is the single open design question this readiness review surfaces rather than resolves: when `buildActionArguments()` returns `kind: 'unavailable'` (e.g., `check_room_availability` with no resolvable inventory id — which, per Step 4's report, is every real call today), what should the customer actually receive? Options include a generic fallback reply (there's precedent: `src/lib/ai.ts`'s own `FALLBACK_MESSAGE`, "I'm having a brief connectivity issue..."), silently escalating to `handoff_to_human`, or logging only with no reply at all. This needs an explicit decision before or during Step 5's implementation — not deferred silently, since it directly determines what a real customer sees once Step 6 ever goes live.
- **First real invocation risk.** Every prior step in this backlog has been provably inert because nothing called the code under test outside its own unit tests. Step 5 is the first file that, if it were ever wired to something live, would actually call `chatWithAI()`, `checkAvailability()`, `captureLeadWithJourney()`, etc. It still won't be wired to anything live in Step 5 itself — but the Executor's own error handling around those calls (try/catch, timeouts, partial-failure behavior) needs to be genuinely correct now, since Step 6 will not re-review this file's internals, only its wiring.
- **`orchestration_decisions` doesn't exist in any real database yet.** Step 2's migration (`025_orchestration_observability.sql`) was reviewed and drafted but, per its own report, has not been applied to any environment. Step 5's shadow-mode write path targets that table; its own tests mock Supabase entirely, so this doesn't block Step 5's own implementation or tests — but it is a hard prerequisite for Step 6 (the first time this code would run against a real database). Flagged as a dependency, not a blocker to this step.
- **Mock-hoisting mistake**, same category as every prior test file in this codebase — mitigated by following the already-proven-correct deferred-closure pattern from the start.

## Dependencies

- **Step 4's `action-arguments.ts`** — direct, load-bearing. Step 5 is its first real consumer (see the dedicated section below).
- **Step 3's `auto-responder.ts` exports** — indirect, via Step 4: the `template_reply` results Step 5 sends are `MESSAGES` templates Step 4 already resolved; Step 5 does not import `auto-responder.ts` directly.
- **`tool-registry.ts`'s `getTool()`** — direct, new for this file specifically (Step 4 avoided importing it in its own test for performance reasons, but the Executor genuinely needs the real tool lookup to call `tool.fn`).
- **`orchestrator.ts`'s `checkAndApplyHandoff()`** — direct, existing, untouched — reused, not reimplemented, for the active-mode post-reply handoff check.
- **`unified-conversation-service.ts`'s `recordMessage()`** — direct, existing, untouched — reused for active-mode message recording.
- **Step 2's `orchestration_decisions` table** — soft dependency (see Risks): required before this code can ever run against a real database, not required for Step 5's own implementation or test suite.

## Acceptance Criteria

- All 13 actions have a passing Executor test, correctly branching on `action-arguments.ts`'s actual `kind` union (not the simpler shape the original design doc assumed before Step 4 existed).
- Shadow vs. active mode are provably distinct (dedicated tests for each).
- `SlotConflict` data passes through to `orchestration_decisions.conflicts` unchanged.
- The `unavailable`-kind behavior is explicitly decided and tested, not left as an accidental gap.
- A thrown/rejected `tool.fn` degrades to a structured result, never an uncaught exception.
- `tsc --noEmit`, `npm run lint`, `npm test` all green.
- Confirmed via grep: zero files outside `orchestration-executor.ts`/`orchestration-executor.test.ts` reference the new module.

## Definition of Done

Merged alone, full test coverage per above, still zero live callers, ready for Step 6 to be the first step that actually wires a route to any of this — and only after Step 2's migration has been applied to whatever environment Step 6 targets.

## Production Blast Radius Assessment

**Zero**, identical in kind to Steps 1–4's assessment. `orchestration-executor.ts` will have no importer outside its own test file. There is no route, cron job, webhook, or UI component that reaches this code in Step 5's delivered state. The only way to exercise it is the test runner calling it directly. A defect here — including in the `tool.fn` error-handling paths that matter most once this file does eventually get wired up — would surface only in its own tests or, later, when Step 6 (a separately approved step) actually connects a caller to it.

---

## Where Step 5 Becomes the First Consumer of Step 4

Explicitly, every point of contact between the two files:

1. **`ActionArgumentsContext` construction.** Step 5 is the first code, anywhere, that will actually build a real `ActionArgumentsContext` object from a real `OrchestrationSuccess` and call `buildActionArguments()` with it. Step 4's own test file constructs this context too, but synthetically, for unit-testing in isolation — Step 5 is the first place it's built from an actual orchestration outcome (even though, in Step 5's own tests, that outcome is still itself a test fixture, not a live one).
2. **Branching on `ActionArgumentsResult.kind`.** Nothing outside `action-arguments.test.ts` has ever inspected this discriminated union before. Step 5's entire control flow is built around it.
3. **The `downgraded` recursion.** Step 4's test suite verifies `generate_proposal` produces a `downgraded` result pointing at `notify_staff`'s own result — but nothing has ever actually *followed* that redirection before. Step 5 is the first code to recurse into `result.result` and act on it.
4. **The `unavailable` kind reaching a real decision point.** Step 4 tests prove `unavailable` results are produced correctly; Step 5 is the first place anything has to decide what a customer (or the shadow log) actually sees when that happens — this review's one open design question, above.

## Does Any Runtime Path Become Reachable?

**No.** Step 5, exactly like Steps 1 through 4, produces new files with zero importers outside their own test suite. `orchestrate()` remains unwired from every channel adapter; `orchestration-executor.ts` will be fully built, fully tested, and fully unreachable from any live request until Step 6 explicitly wires the webhook route to call it — which is a separate, not-yet-approved step, gated behind its own readiness review, exactly like every step so far.

---

## Explicit Confirmations

- **Feature flag remains OFF.** Step 5 does not read `settings.orchestration` — `mode` is an explicit parameter the (still-nonexistent) caller would supply, not something this file looks up itself.
- **No live route activation occurs in Step 5.** No route, webhook, or scheduled job is modified or gains a new import.
- **Customer-visible behavior remains unchanged unless explicitly approved.** Nothing in this step can affect any customer-visible behavior — there is no code path from any real request to `orchestration-executor.ts` in this step's delivered state.

**Awaiting approval before implementation. Step 5 will not begin without it.**
