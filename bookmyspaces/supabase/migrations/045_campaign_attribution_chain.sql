-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 045: End-to-End Campaign Attribution
-- ═══════════════════════════════════════════════════════════════════════════
-- Completes the Business Package -> Social Post -> Campaign -> Click -> Lead
-- -> Proposal -> Reservation -> Revenue chain. Every other link already
-- exists:
--   - social_posts.business_package_id      (migration 043)
--   - social_posts.platform/external_post_id (migration 014 — these ARE
--     source_platform/source_post_id; no rename needed)
--   - leads/proposals/reservations.business_package_id (migrations 043/044)
--   - leads.campaign/utm_source/utm_medium/utm_campaign (migration 026)
--   - clicks preserved via analytics_events.properties JSONB — no schema
--     change needed there, just a new key written by the route layer
--   - social_post_metrics.clicks (migration 037) — per-post click counts,
--     reused for the new per-post revenue split (see
--     src/lib/analytics/social-attribution-service.ts)
--
-- The ONE genuinely missing link is a way for a social post to point at the
-- outbound campaign entity (broadcast_campaigns, migration 004/030) it
-- belongs to — added below, same nullable/additive/ON DELETE SET NULL
-- pattern as social_posts.business_package_id.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES broadcast_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_campaign_id ON social_posts(campaign_id);

COMMENT ON COLUMN social_posts.campaign_id IS
  'End-to-End Campaign Attribution — optional link to the broadcast_campaigns row this post promotes, so Revenue by Campaign can include the social side alongside outbound WhatsApp sends. Null for posts not tied to a tracked campaign.';

COMMIT;
