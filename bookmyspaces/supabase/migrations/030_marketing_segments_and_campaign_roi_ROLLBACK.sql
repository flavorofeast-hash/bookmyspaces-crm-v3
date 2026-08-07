-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 030_marketing_segments_and_campaign_roi.sql
-- WARNING: drops marketing_segments and its data. broadcast_campaigns.budget/
-- segment_id are also dropped — any ROI figures / segment links are lost.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE broadcast_campaigns
  DROP COLUMN IF EXISTS segment_id,
  DROP COLUMN IF EXISTS budget;

DROP TABLE IF EXISTS marketing_segments;

COMMIT;
