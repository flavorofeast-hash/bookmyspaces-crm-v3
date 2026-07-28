# Phase 1B — Step 2 Readiness Review
**Database: `unified_messages` idempotency + `orchestration_decisions` observability table**

Baseline: commit `fa7df34` (Step 1 merged), branch `release/v1.0.0-rc2`. 38/38 files, 325/325 tests passing per the user-provided local verification.

Status: **review only — no code or migration has been written.**

Re-verified against the current repo state before writing this review (not assumed from the earlier design doc):
- `supabase/migrations/` still ends at `024_event_sales_expansion.sql` / `_ROLLBACK.sql` — next number is `025`, unchanged from the original plan.
- `012_v3_foundation_schema.sql` already defines `unified_messages.external_message_id TEXT` (nullable, no uniqueness) plus a **plain, non-unique** index: `CREATE INDEX IF NOT EXISTS idx_unified_messages_external_id ON unified_messages(external_message_id)`. This is new information since the original backlog was written — Step 2 adds a *second*, partial *unique* index alongside this existing plain one (Section 3 below), it does not need to create the column or the first index.
- No `orchestration_decisions` table exists anywhere in `supabase/` or `src/`. Confirmed via grep — clean slate, no naming collision.

---

## 1. Objectives of Step 2

Two independent, additive schema changes, shipped together because they're both inert-until-read infrastructure for the same later step (Step 6):
1. Give `inbound-guard.ts`'s `isDuplicateDelivery` check a real, enforceable backing store — today nothing enforces uniqueness on `(channel, external_message_id)` for `unified_messages`, so a Meta webhook redelivery on the *live* path would currently produce a second row silently (the existing index is for lookup speed, not correctness).
2. Create somewhere durable for `orchestrate()`'s decision to be written once Step 6 starts computing it in shadow mode — without this table, "log it" has no home besides free-text application logs, which aren't reviewable as a dataset.

Step 2 does **not** wire either of these into any code path. It is schema only.

## 2. Architectural Impact

None to the running application. `unified_messages`, `unified_conversations`, and `channels` (all migration 012) are extended, not altered in shape for any existing column — every existing SELECT/INSERT against `unified_messages` continues to work unchanged, since the new unique index only rejects a write that would already have been a logically-incorrect duplicate, and nothing in the current codebase (confirmed: `unified-conversation-service.ts`'s `recordMessage()`, the webhook's `syncToUnifiedConversationPlatform()`) currently inserts two rows with the same `(channel_id, external_message_id)` in normal operation — a genuine Meta redelivery is the only realistic trigger, and today's code has no test coverage proving that scenario doesn't already happen. This is flagged as a pre-migration verification task (Section 11), not a blocker to writing the migration.

`orchestration_decisions` is a brand-new, standalone table with foreign keys into `unified_conversations`/`unified_messages` — additive only, zero impact on any existing table or query.

## 3. Files to Modify

None in `src/`. None in `supabase/migrations/` (no existing migration file is edited — this repo's own convention, visible in 015 through 024, is always a new numbered file, never an edit to a past one).

## 4. New Files to Create

- `supabase/migrations/025_orchestration_observability.sql`
- `supabase/migrations/025_orchestration_observability_ROLLBACK.sql`

Draft contents (for review only — not applied in this step):

```sql
-- 025_orchestration_observability.sql

-- Idempotency: reject a second unified_messages row for the same
-- (channel, external id) pair. Partial (WHERE external_message_id IS NOT
-- NULL) so channels/messages without a native external id (e.g. an
-- internally-created message) are never affected.
CREATE UNIQUE INDEX IF NOT EXISTS unified_messages_channel_external_id_uq
  ON unified_messages (channel_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- Shadow/active-mode decision log -- see audit/PHASE_1B_DESIGN_DOCUMENT.md
-- Section 5.2. Not read or written by any code as of this migration.
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
```sql
-- 025_orchestration_observability_ROLLBACK.sql
DROP TABLE IF EXISTS orchestration_decisions;
DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;
```

No RLS *policy* is drafted yet beyond enabling RLS on the new table — matching migration 012's own pattern where `ENABLE ROW LEVEL SECURITY` is set per-table and policies are added separately; confirm during implementation whether this repo's convention adds policies in the same migration or a follow-up (012 itself should be checked for this before Step 2 is implemented, not assumed here).

## 5. Files That Must NOT Be Modified

Everything except the two new files above. Explicitly, per the standing constraints and re-confirmed for this step: the WhatsApp webhook route, `process-inbound.ts`, `orchestrate()` and every Phase 1A.1 file under `src/lib/ai/`, `auto-responder.ts`, `unified-conversation-service.ts`, any existing migration file (012–024 and their rollbacks), `settings-service.ts` (Step 1's file — already merged, not touched again here), any route under `src/app/api/`.

## 6. Runtime Behavior Changes

None. No application code reads or writes either the new index or the new table. The unique index is the only piece with any live-data interaction at all, and only in the negative sense: it would reject an insert that violates it — but zero code paths insert into `unified_messages` today at a volume or pattern that should ever hit it in normal operation (the pre-migration verification in Section 11 exists specifically to rule out an existing, latent double-insert pattern before this goes anywhere near production data).

## 7. Feature Flag Usage

None consulted. This step is schema-only and precedes any code that would check `settings.orchestration.enabled` (Step 1's flag stays exactly as it is — still unread by anything). Applying this migration to production is itself safe regardless of the flag's value, since nothing acts on the new table/index yet.

## 8. Unit Tests Required

Schema changes have no unit-testable application logic by themselves. Required instead:
- A migration-application check: `025` applies cleanly against a fresh copy of the schema built from `001`…`024` in order (matching whatever mechanism this repo already uses to validate migrations — see `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` for the precedent; reuse that process rather than inventing a new one).
- A rollback check: `025_..._ROLLBACK.sql` applies cleanly immediately after `025` and leaves the schema byte-for-byte equivalent to pre-`025` (no orphaned index/table/column).

## 9. Integration Tests Required

- Insert two `unified_messages` rows with the same `(channel_id, external_message_id)` and a non-null `external_message_id`; assert the second insert is rejected by the new unique index (proves the constraint is real, not just present).
- Insert two `unified_messages` rows with the same `channel_id` and `external_message_id IS NULL` (both); assert both succeed (proves the partial-index scoping is correct and doesn't over-restrict the common null case).
- Insert a well-formed `orchestration_decisions` row referencing a real `conversation_id`/`message_id`; assert the FK constraints hold and RLS is enabled (a query with no service-role bypass should be denied, matching every other table's pattern in migration 012).

## 10. Rollback Strategy

Run `025_orchestration_observability_ROLLBACK.sql`. Safe unconditionally at any point before a later step (Step 6) begins writing to `orchestration_decisions` or relying on the unique index for `isDuplicateDelivery` — until then, nothing depends on either object existing, so dropping them back out has zero downstream effect. If the migration has already been applied to production and the unique index unexpectedly rejects a legitimate write pattern discovered post-deploy (see Section 11's risk), the *index alone* can be dropped independently of the `orchestration_decisions` table (`DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;`) without a full rollback, giving a narrower fix if only one half of this step turns out to be the problem.

## 11. Risks

- **Primary risk — traced during this review, not left open:** checked `syncToUnifiedConversationPlatform()` (webhook route) and `recordMessage()`/`ingestInboundMessage()` (`unified-conversation-service.ts`) for any retry-on-error path that might re-attempt a mirror write. Found none — there is no retry logic anywhere in this chain today. The only realistic way `(channel_id, external_message_id)` repeats is a genuine Meta webhook redelivery, which is exactly the scenario Critical Issue 2 (Hardening Sprint) was written to guard against. Tracing the failure path confirms this migration is **safe, and a strict improvement, not a behavior change**: `recordMessage()` throws on insert failure; that throw propagates up through `handleInboundMessage()` to the webhook route's `syncToUnifiedConversationPlatform(...).catch(err => logger.error(...))` call, which already treats this mirror as fire-and-forget and non-fatal (its own header comment: "a failure here... must never affect the WhatsApp reply already sent"). So post-migration, a Meta redelivery produces one logged, rejected insert instead of one silent duplicate row — better data quality, zero change to the customer-facing reply, and zero change to whether the webhook responds 200 to Meta. Also confirmed: the customer-facing reply path (`buildAutoReply`/`sendWhatsAppText`, Pipeline A) is entirely separate from this mirror and has no idempotency guard of its own either way — this migration does not touch whether a customer could still receive a duplicate *reply* on a Meta redelivery today; it only fixes duplicate *mirrored records*, which is exactly this step's stated scope.
- **Secondary risk:** the pre-existing plain index (`idx_unified_messages_external_id`) and the new partial unique index will both exist on overlapping data after this migration — not a correctness risk, but a minor redundant-index footprint worth a one-line note in the migration file (or a follow-up to drop the old one once the unique index is proven safe in production) rather than silently carrying two indexes indefinitely.
- **Low risk:** RLS-enabled-with-no-policy on `orchestration_decisions` could make the table unreadable even to intended future readers if this repo's convention requires an explicit policy alongside `ENABLE ROW LEVEL SECURITY` — needs the same check against migration 012's actual policy pattern noted in Section 4.

## 12. Acceptance Criteria

- `025_orchestration_observability.sql` and its `_ROLLBACK.sql` both apply cleanly to a staging copy of the current schema, in either order relative to each other (apply-then-rollback leaves the schema unchanged).
- The three integration tests in Section 9 all pass.
- Zero existing tests (unit or otherwise) change behavior as a result of applying this migration to a test database.

## 13. Definition of Done

Migration + rollback files merged and reviewed; applied to staging (not production, per this repo's apparent convention of a staged rollout — confirm the exact staging→production migration process this project already uses rather than assuming one); no application code changed; Step 1's flag remains the only flag in the system and remains unread.

---

## Explicit Verification Against Your Four Criteria

- **Independently deployable:** yes — two new files, no dependency on any application code change, no dependency on Step 1 beyond it having already merged (which it has).
- **Independently reversible:** yes — a single rollback file reverses both changes together, and the unique index alone can be dropped in isolation if only it turns out to be the problem (Section 10).
- **Feature flag OFF by default:** unaffected — Step 2 doesn't touch the flag from Step 1, which remains `enabled: false` and unread by any code.
- **No customer-visible changes unless explicitly approved:** confirmed true, including the edge case — traced in Section 11: the only code path that could ever hit the new unique index is the fire-and-forget Unified Conversation Platform mirror, which already swallows failures non-fatally and has zero effect on the actual WhatsApp reply the customer receives.

**Recommendation:** proceed to implement Step 2. The Section 11 risk that would have been the only open item is traced and closed in this review — no further pre-implementation investigation needed.

**Awaiting approval before implementation.**
