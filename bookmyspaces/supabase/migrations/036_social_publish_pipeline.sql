-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 036 — Growth Engine Epic 5: Social Publishing completion.
--
-- Additive only. social_posts already has every status/timestamp/error
-- column the publish pipeline needs (migration 014: status, published_at,
-- external_post_id, failure_reason, idx_social_posts_status_scheduled).
-- The one genuinely missing piece is a retry/attempt counter, so publishing
-- history (how many times has this post been tried) is queryable without a
-- separate log table — each social_posts row already IS that post's
-- publishing history (draft -> publishing -> published/failed, with
-- failure_reason + updated_at recording the latest attempt).
--
-- Rollback: 036_social_publish_pipeline_ROLLBACK.sql.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0;
