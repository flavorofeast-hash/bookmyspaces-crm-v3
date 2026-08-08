-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 039: Social Growth Platform Phase 4
-- File  : 039_social_growth_phase4.sql
-- Runs  : AFTER 038_drip_pause_state.sql
--
-- PURPOSE:
--   1. social_posts — Sprint 1 (Social Publishing) Retry/Failure handling.
--      Adds next_retry_at (backoff-scheduled automatic retry time for a
--      transient publish failure) and widens the status CHECK to add
--      'failed_permanent' (a transient failure that exhausted
--      MAX_PUBLISH_ATTEMPTS in src/lib/social/publish-service.ts — the cron
--      stops auto-retrying it, but a human can still force a manual retry
--      via the existing publish action). Same CHECK-widen pattern as
--      migration 038 (drip_sequence_enrollments.status).
--   2. social_interactions — Sprint 3 (Social CRM) intent classification.
--      Adds `intent` (enquiry/complaint/booking_intent/spam), additive
--      alongside the existing `sentiment` column — same "keyword-based now,
--      upgradeable to model-scored behind the same column" convention that
--      column's own header comment already established.
--
-- SCOPE: two columns added, one CHECK constraint widened, on two existing
-- tables. Purely additive — no existing row touched, no other table
-- affected.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'failed_permanent'));

COMMENT ON COLUMN social_posts.next_retry_at IS
  'Backoff-scheduled automatic retry time for a transient publish failure (publish-service.ts). processDueScheduledPosts() drains due failed rows the same way it drains due scheduled rows. NULL once published, once permanently failed, or for a failure that is not retry-eligible (e.g. no adapter configured).';

COMMENT ON COLUMN social_posts.status IS
  'draft/approved/scheduled -> publishing -> published|failed. failed = transient, auto-retried up to MAX_PUBLISH_ATTEMPTS via next_retry_at. failed_permanent = attempts exhausted, no further automatic retry (manual retry via publish action still allowed).';

ALTER TABLE social_interactions ADD COLUMN IF NOT EXISTS intent TEXT
  CHECK (intent IN ('enquiry', 'complaint', 'booking_intent', 'spam') OR intent IS NULL);

CREATE INDEX IF NOT EXISTS idx_social_interactions_intent ON social_interactions(intent) WHERE intent IS NOT NULL;

COMMENT ON COLUMN social_interactions.intent IS
  'Keyword-based intent classification (classifyInteractionIntent() in interaction-service.ts): enquiry/complaint/booking_intent/spam, or NULL when nothing matched. Additive alongside sentiment, same upgradeable-to-model-scored posture.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'social_posts' AND column_name = 'next_retry_at';
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'social_interactions' AND column_name = 'intent';
-- Expect 1 row each.
-- ─────────────────────────────────────────────────────────────────────────────
