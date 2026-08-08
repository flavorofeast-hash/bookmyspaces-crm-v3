-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 041_social_post_approved_at.sql
--
-- Drops social_posts.approved_at. Any recorded approvals of scheduled
-- posts are lost — those posts will fail the approval gate again on their
-- next publish attempt if publish-config.ts's requireApproval is still on
-- (safe fail-closed behavior, not a crash), or simply publish normally if
-- requireApproval is off.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_posts DROP COLUMN IF EXISTS approved_at;

COMMIT;
