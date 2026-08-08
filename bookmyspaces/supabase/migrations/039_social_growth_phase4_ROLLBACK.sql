-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 039_social_growth_phase4.sql
--
-- Reverts social_posts.status CHECK to its pre-039 allowed set and drops
-- next_retry_at. Reverting the status CHECK will FAIL if any row currently
-- has status='failed_permanent' — resolve those rows first (set back to
-- 'failed' or 'draft') before running this rollback, same discipline as
-- every other CHECK-widen rollback in this project.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_interactions DROP COLUMN IF EXISTS intent;

ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed'));

ALTER TABLE social_posts DROP COLUMN IF EXISTS next_retry_at;

COMMIT;
