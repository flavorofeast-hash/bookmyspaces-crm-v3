# Phase 1B — Step 5 Implementation Report
**Build `orchestration-executor.ts`**

Baseline: Step 4 approved and closed out. Step 5 Readiness Review approved.

---

## Files Modified
None.

## Files Created
- `src/lib/ai/orchestration-executor.ts`
- `src/lib/ai/orchestration-executor.test.ts`

## Canonical Orchestration Result Contract

`action-arguments.ts` (Step 4) produces exactly one of four result kinds. This step treats all four as the canonical interface this file is built around — none collapsed, none inferred, each with its own documented handling site in `orchestration-executor.ts`'s file header and reproduced here for the record.

| Kind | What it means | This file's handling | Consumer responsibility (for a future Step 6 caller) |
|---|---|---|---|
| `tool_call` | A real `tool-registry.ts` function is ready to call with `result.args`. | Active mode only: looks up `tool.fn` via `getTool(result.action)` and calls it, wrapped in try/catch. **Only `answer_immediately`'s registered tool (`chatWithAI`) returns an already-approved, ready-to-send customer string** — every other action's return value is raw business data (availability rows, package prices, a lead record, a queue id, `void`). This file does **not** format that raw data into new customer-facing copy — `replyText` stays `null` for every `tool_call` action except `answer_immediately`, even when the call succeeds. | May trust `replyText` when non-null. Must not assume the underlying tool's raw return value (not exposed by `ExecutorResult`) means anything customer-facing — if a future step wants e.g. `generate_quotation`'s package list turned into a reply, that's a new, separately-designed formatting decision, not something this file already does. |
| `template_reply` | An existing, already-approved `MESSAGES` template (`auto-responder.ts`, exported Step 3) is the reply, verbatim. | Active mode: sends `result.replyText` as-is. No tool call. | May always trust `replyText` when this kind produced one — it is pre-approved copy, not synthesized. |
| `downgraded` | Today, always `generate_proposal → notify_staff`. | Recurses into `result.result` (itself one of the four kinds) and acts on **that**, while always recording that a downgrade occurred (`sideEffectsApplied` gets a `downgraded:X->Y` entry regardless of whether the downgraded-to action itself succeeds — an honest audit trail, not collapsed away even when the sub-result is also a no-op). | Should treat the outcome exactly like whatever kind the recursion bottomed out at; `sideEffectsApplied` records the downgrade itself for observability, separately from whatever the sub-result's own side effects were. |
| `unavailable` | Step 4 could not build real arguments for this action with data available today (e.g. no resolvable inventory item id — every real `check_room_availability`/`check_banquet_availability` call, currently). | **Explicitly not resolved by this step, per instruction.** No reply is sent, no side effect is applied, no messaging is invented. Current (i.e., no-op) behavior is preserved. | **Must not assume "no reply" means "nothing to do here."** This is the one case this step deliberately leaves as an open product/rollout decision — see "Step 6 Rollout Decision Needed," below. |

## Tests Added

11 tests, covering every branch explicitly (none collapsed):
- **Shadow mode** (2): `answer_immediately` (`tool_call` kind) and `collect_missing_information` (`template_reply` kind) both confirm zero execution — no tool call, no send, no `recordMessage`, no handoff check — and exactly one `orchestration_decisions` row logged with `mode: 'shadow'`, `executed: false`.
- **Active mode, `tool_call`** (3): `answer_immediately` (tool's return value IS the reply — full send/record/handoff chain verified); `notify_staff` (tool call executes for real, but its raw return value is *not* turned into a reply — the "never invent messaging from raw tool data" rule, exercised end to end, with `executed: true` in the decision log since a real side effect did occur even though no reply was sent); a thrown/rejected `tool.fn` (degrades to a structured `tool_call_failed:*` result, never crashes, decision still logged).
- **Active mode, `template_reply`** (1): confirms the exact template text is sent, recorded, and triggers the handoff check.
- **Active mode, `downgraded`** (2): `generate_proposal` recursing into a successful `notify_staff` (downgrade note + the sub-result's own side effect both present); the same recursion when the sub-result is itself `unavailable` (the downgrade note is still recorded — proving the redirect itself is never silently dropped, even when nothing further executes).
- **Active mode, `unavailable`** (1): `check_room_availability` with no `inventoryItemId` — confirms zero execution of any kind and `result.kind === 'unavailable'` surfaces correctly to a caller.
- **SlotConflict pass-through** (1): confirms Critical Issue 1's conflict data reaches both the `ExecutorResult` and the `orchestration_decisions` row unchanged — the first place in the entire Phase 1A.1/1B effort this data lands anywhere durable.
- **Decision-logging failure is non-fatal** (1): a failed `orchestration_decisions` insert still returns a valid, usable `ExecutorResult` (`decisionRecorded: false`), never throws.

Two real bugs were found and fixed while getting these to pass (recorded honestly, not smoothed over): a test-file bug where `sendMock` wasn't cleared between tests (leaking call history across test cases — fixed by adding it to `beforeEach`), and two initially-wrong test expectations that assumed `sideEffectsApplied`/`executed` should be empty/false whenever no *reply* was produced — the actual, more correct behavior (kept as implemented, tests corrected instead) is that both reflect whether a real *side effect* happened (a tool call executing, or a downgrade decision being made), independent of whether a customer reply resulted from it.

## Lint Results
```
npx eslint src/lib/ai/orchestration-executor.ts src/lib/ai/orchestration-executor.test.ts → exit 0
npm run lint (full project) → exit 0
```

## TypeScript Results
```
npx tsc --noEmit (full project) → exit 0, zero errors
```

## Test Results
```
npx vitest run src/lib/ai/orchestration-executor.test.ts
 ✓ src/lib/ai/orchestration-executor.test.ts  (11 tests) 8ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```
Full 38-file suite: attempted in-sandbox; consistent with every prior attempt in this project, did not finish within this sandbox's per-command time limit. Individually confirmed passing in this session: `orchestration-executor.test.ts` (11/11), `action-arguments.test.ts` (25/25), plus `auto-responder.test.ts` (16/16) and `settings-service.test.ts` (13/13) confirmed earlier this session. The authoritative 38/38-plus-11 count still needs a local `npm test` run.

Note on sandbox performance: this file's test suite mocks `@/lib/ai/tool-registry` entirely (rather than importing it for real, as Step 4's test file initially did by mistake) — this avoids the `googleapis` dependency chain documented as a source of timeouts elsewhere in this project, and the test run completed comfortably within budget (~24-28s) as a result.

## Risks Introduced
- **None beyond Steps 1–4's baseline.** Confirmed by grep: the only importer of `orchestration-executor.ts` anywhere in `src/` is its own test file.

## Risks Eliminated
- None new — Step 5 is the Executor itself, not a fix to a prior gap. It does make Step 4's argument-building layer actually actionable for the first time (see "first consumer" analysis in the approved readiness review), which is the entire point of this step.

## Rollback Procedure
Delete `src/lib/ai/orchestration-executor.ts` and `src/lib/ai/orchestration-executor.test.ts`. No caller, no data involved.

---

## Explicit Confirmations

- **Feature flag unchanged.** `settings-service.ts` was not touched; `orchestration.enabled` remains `false`. `mode` is an explicit parameter this file's caller would supply — this file never reads `settings.orchestration` itself.
- **No runtime orchestration activation.** No route, webhook, or scheduled job references this file.
- **No live route wiring.** Confirmed by grep.
- **No customer-visible behavior.** There is no code path from any real request to `orchestration-executor.ts` in this step's delivered state.
- **Independently deployable.** Two new, self-contained files.
- **Independently reversible.** Two-file deletion, no data involved.

## Step 6 Rollout Decision Needed (recorded, not resolved)

Per explicit instruction, this step does **not** decide what a customer should see when a result comes back `unavailable` — current (no-op) behavior is preserved. This needs an explicit decision before Step 6 (or whichever step first wires a live caller) goes anywhere near real traffic:

- **Option A:** a generic fallback reply — there's direct precedent already in this codebase, `src/lib/ai.ts`'s own `FALLBACK_MESSAGE` ("I'm having a brief connectivity issue 🙏 Please WhatsApp us at *9051459463*...").
- **Option B:** silently escalate to `handoff_to_human` whenever a decision comes back `unavailable`, on the reasoning that "the automated pipeline couldn't act" is itself a handoff-worthy condition.
- **Option C:** no reply at all, relying on the existing non-orchestration reply path (Pipeline A, per the design doc) to have already sent something, with the `unavailable` decision logged purely for observability.

Not decided here. Given Step 4's own finding that `check_room_availability`/`check_banquet_availability` will return `unavailable` on **every** real call today (no inventory-item resolver exists anywhere in this codebase), this is not a rare edge case — it is the default outcome for two of the thirteen actions, and deserves a deliberate product decision rather than an engineering default.

## Known Follow-up Items (carried forward, unchanged by Step 5)

Same as Steps 2–4's close-outs — the unpatched `next@14.2.5` CVE cluster, the two secret-management findings, the `MASTER_ENGINEERING_SPECIFICATION.md` discrepancy, the design doc's remaining open questions, and the `handoff_to_human`/`HandoffReason` gap found in Step 4 — plus the new item directly above.

**Step 5 complete. Stopping here per instruction — awaiting approval before Step 6.**
