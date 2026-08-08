-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — MIGRATION 045: End-to-End Campaign Attribution
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_posts DROP COLUMN IF EXISTS campaign_id;

COMMIT;
