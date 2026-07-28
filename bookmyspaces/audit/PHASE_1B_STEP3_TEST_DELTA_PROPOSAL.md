# Phase 1B Step 3 — Proposed Test Delta (NOT APPLIED)

**Status: proposal only. `src/lib/whatsapp/auto-responder.test.ts` has NOT been modified by this document. No merge has been performed.**

**Why this document exists:** while implementing the minimal `processAutoResponse()` regression test requested in your last message, I found that `src/lib/whatsapp/auto-responder.test.ts` is being actively written by another process concurrently with this session. I applied my change once, verified it (24 tests passing, lint clean, `tsc --noEmit` clean), and then found the file reverted to its narrower, pre-change version moments later — my regression tests were gone. Per your explicit instruction, I am not re-applying the change, not merging automatically, and am instead recording exactly what I intended to add so it can be manually reconciled once the file is stable.

---

## Additional files detected as currently being modified by the other process

Beyond `auto-responder.test.ts` itself, two more files changed very recently (within the last ~2 minutes of this report, current time 19:40 IST) and were not created or touched by this session:

- `audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md` — grew from 28,670 to 29,260 bytes, last modified 19:38:07.
- `audit/PHASE_1B_STEP3_REPORT.md` — new file, created 19:38:42, did not exist before this.

Both are exactly the two deliverables you asked this session to produce as part of Step 3 close-out. **I have not opened either file's contents for this report beyond confirming their existence and size/timestamp via directory listing** — per your instruction to list and stop, not to read/reconcile them yet. Both should be treated as possibly still in motion.

**No other file under `src/`, `supabase/migrations/`, or `package.json`/`package-lock.json` showed a modification time newer than `auto-responder.ts` itself (19:29:36) at the time of this check.**

---

## What my version of `auto-responder.test.ts` currently on disk (baseline, unaffected)

The file on disk right now (verified via direct read and independently via `wc -l` = 155 lines, `grep -c processAutoResponse` = 2, both matching) is the **original, narrower version**: `MESSAGES` template pinning tests (12 tests, including the 3-test `ASK_EVENT_TYPE` sub-block) and `notifyOperator` tests (4 tests) — 16 tests total, 17 with the top-level `describe` blocks counted differently depending on how vitest reports nesting (my own verified run against my version reported 24; the original narrower version reports however many it reports when actually run — not re-verified against a live run in this report, per instruction not to touch the file).

This baseline file's own header comment explicitly states it does **not** include `processAutoResponse()` regression coverage, and explains why (scoped out per the concurrently-written readiness review's Section 8).

---

## Exactly what my proposed version adds, on top of that baseline

**No changes to the existing `MESSAGES` or `notifyOperator` describe blocks** — every one of those 16 existing tests is preserved verbatim in my version. My version only:

### 1. New imports (added to the top of the file)

```ts
import { ConversationState, SourceChannel } from '@/constants/conversation-states'
import type { WhatsAppConversation } from '@/types/whatsapp'
```
And extends the existing import line from `./auto-responder`:
```ts
// before:
import { MESSAGES, notifyOperator } from './auto-responder'
// after:
import { MESSAGES, notifyOperator, processAutoResponse } from './auto-responder'
```

### 2. New shared test infrastructure (module-level, above the existing `vi.mock` calls)

- A `dbCalls` array: `const dbCalls: Array<{ table: string; op: 'update' | 'insert'; payload: unknown }> = []` — a flat call log for every `supabase.from(<table>).update(...)`/`.insert(...)` invocation, used to assert on `leads`, `activity_logs`, and `whatsapp_conversations` writes without building a full query-builder simulation.
- A `makeChain(table: string)` helper function producing a chainable mock object (`select`/`update`/`insert`/`eq`/`is`/`maybeSingle`, and a `then()` so it can be `await`ed directly) that records `update`/`insert` calls into `dbCalls` and, for `notification_settings` specifically, still resolves `maybeSingle()` against the existing `mockDb.notificationSetting` — preserving the exact existing `notifyOperator` test behavior.

### 3. Modified mock (the existing `@/lib/supabase` mock is broadened, not replaced with different semantics)

```ts
// before (baseline, current):
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'notification_settings') throw new Error(`unexpected table: ${table}`)
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockDb.notificationSetting }) }) }) }
    },
  }),
}))

// after (proposed):
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => makeChain(table),
  }),
}))
```

**Why this change is needed, not optional:** `processAutoResponse()` writes to `leads` and `activity_logs` (via the same `getSupabaseAdmin()` import), and its own advancement calls the real, un-mocked `advanceConversationState()` from `./conversation-manager`, which writes to `whatsapp_conversations` through the same client. The existing mock throws on any table other than `notification_settings`, so it would throw immediately on the first `processAutoResponse()` call in any state past `NEW_INQUIRY`. Broadening it to a generic chain is the minimal change that supports both the existing `notifyOperator` tests (unaffected — same `notification_settings` behavior) and the new tests, without introducing a second, parallel mock of the same module (which `vi.mock` does not support cleanly per-file).

**Effect on existing tests:** none. The existing `notifyOperator` tests never touch any table other than `notification_settings`, so their behavior is identical under the broadened mock. The one behavioral difference is that the mock no longer throws on an unexpected table name — that throw was never asserted by any existing test, only a defensive guard, so no existing test's pass/fail outcome changes.

### 4. `advanceConversationState` is deliberately left un-mocked

The real implementation from `./conversation-manager` runs against the same mocked `@/lib/supabase`, so its `whatsapp_conversations` update is captured in `dbCalls` like any other write. This was a deliberate choice to avoid adding a second mock (`./conversation-manager`) when the existing broadened Supabase mock already covers it — fewer mocks to keep in sync, closer to today's real wiring.

### 5. A new `makeConversation()` test helper

```ts
function makeConversation(overrides: Partial<WhatsAppConversation> = {}): WhatsAppConversation {
  return {
    id: 'conv-1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    phone: '919830509991', lead_id: 'lead-1', source_channel: SourceChannel.WEBSITE,
    current_state: ConversationState.NEW_INQUIRY,
    collected_name: null, collected_event_type: null, collected_event_date: null, collected_guest_count: null,
    assigned_to: null, last_message_at: '2026-01-01T00:00:00.000Z', qualified_at: null, handoff_at: null,
    ...overrides,
  }
}
```
Builds a valid, fully-typed `WhatsAppConversation` object with sensible defaults, overridable per test — avoids repeating the full shape in every test case.

### 6. `beforeEach` extended by one line

```ts
// before:
beforeEach(() => {
  mockDb.notificationSetting = null
  sendWhatsAppTextMock.mockClear()
})
// after:
beforeEach(() => {
  mockDb.notificationSetting = null
  sendWhatsAppTextMock.mockClear()
  dbCalls.length = 0   // <-- new line
})
```

### 7. New describe block: `processAutoResponse (Step 3 -- minimal regression baseline, not full coverage)`

Eight new tests, each with its rationale:

| # | Test | Assertion(s) | Why this test, specifically |
|---|---|---|---|
| 1 | `NEW_INQUIRY: greets, advances to WAITING_FOR_EVENT_TYPE, sends once` | `count === 1`; `sendWhatsAppText` called once with `MESSAGES.GREETING('Priya')`; `dbCalls` contains a `whatsapp_conversations` update with `current_state: WAITING_FOR_EVENT_TYPE` | Pins the entry-point state — the one every real conversation starts in. |
| 2 | `WAITING_FOR_EVENT_TYPE: captures event type, asks for date, advances` | `count === 1`; sends `MESSAGES.ASK_EVENT_DATE`; `leads` update payload has `event_type: 'Wedding'` | Pins that customer-supplied text is actually captured into `leads`, not just acknowledged. |
| 3 | `WAITING_FOR_EVENT_TYPE: blank text is a no-op (returns 0, sends nothing)` | `count === 0`; `sendWhatsAppText` never called | Pins the existing guard-clause behavior (`if (!text) return 0`) so a future change can't silently remove it. |
| 4 | `WAITING_FOR_EVENT_DATE: a date-like reply asks for guest count and advances` | `count === 1`; sends `MESSAGES.ASK_GUEST_COUNT`; advances to `WAITING_FOR_GUEST_COUNT` | Pins the "happy path" date-recognition branch. |
| 5 | `WAITING_FOR_EVENT_DATE: a non-date-like reply re-asks and does not advance` | `count === 1`; sends `MESSAGES.UNRECOGNISED_DATE`; no `whatsapp_conversations` update occurs | Pins the *other* branch of `looksLikeDate()` — this is the one place the function deliberately does not advance state, and it's cheap to lose silently in a refactor. |
| 6 | `WAITING_FOR_GUEST_COUNT: qualifies, notifies operator, hands off -- sends 3 messages, returns 2` | `count === 2`; `sendWhatsAppText` called exactly 3 times (`QUALIFIED`, `notifyOperator`'s internal alert, `HANDOFF`); `leads` update has `status: 'followup_pending'`; an `activity_logs` insert occurred | The most complex branch in the file — the only one that fans out into 3 sends, 2 DB tables, and a nested call to `notifyOperator`. This is exactly the branch most likely to regress silently if anything upstream (Step 4/5) changes calling convention. |
| 7 | `terminal state (QUALIFIED) short-circuits: sends nothing, returns 0` | `count === 0`; `sendWhatsAppText` never called | Pins the `TERMINAL_STATES` guard for one of its two members. |
| 8 | `terminal state (HANDOFF_TO_OPERATOR) short-circuits: sends nothing, returns 0` | `count === 0`; `sendWhatsAppText` never called | Pins the guard for the second `TERMINAL_STATES` member — cheap to add once the first is written, and it's a different enum value than #7. |

**Explicitly not covered (by design, consistent with "minimal, not a full backfill"):** `parseInt`/guest-count-parsing edge cases, malformed dates beyond one representative non-date string, concurrent/duplicate-webhook scenarios, and any assertion about `activity_logs`' exact description string content (only presence of the insert is checked, not its full payload).

---

## Verified results against my version, before it was overwritten

```
npx vitest run src/lib/whatsapp/auto-responder.test.ts
 ✓ src/lib/whatsapp/auto-responder.test.ts  (24 tests) 6ms
 Test Files  1 passed (1)
      Tests  24 passed (24)

npx eslint src/lib/whatsapp/auto-responder.ts src/lib/whatsapp/auto-responder.test.ts
(no output -- exit 0)

npx tsc --noEmit
(no output -- exit 0, full project)
```

16 pre-existing tests + 8 new = 24, matching exactly.

---

## Explicit non-actions

- `auto-responder.test.ts` has not been touched again since the revert was detected.
- No merge, partial or automatic, has been attempted.
- `audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md` and `audit/PHASE_1B_STEP3_REPORT.md` have not been read or modified by this session — only their existence, size, and timestamp were checked, per instruction to list and stop.
- Step 3 is not being marked complete by this session. Awaiting confirmation that the file is stable before any reconciliation.
