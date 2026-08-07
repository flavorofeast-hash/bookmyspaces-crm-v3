-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 036_social_publish_pipeline.sql — drops publish_attempts.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_posts DROP COLUMN IF EXISTS publish_attempts;

COMMIT;
