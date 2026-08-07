-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 030: Saved Marketing Segments + Campaign ROI
-- File  : 030_marketing_segments_and_campaign_roi.sql
-- Runs  : AFTER 004_phase4_campaigns.sql (extends `broadcast_campaigns`)
--
-- PURPOSE (Growth Platform Phase 1 — Saved Segments, Campaign ROI):
-- src/lib/campaigns.ts's buildSegment() already supports ~15 filter
-- dimensions (status/source/VIP/CLV/repeat/dormant/birthday/anniversary/
-- corporate/etc.), but every campaign stores its own inline `segment` JSONB
-- — there is no way to name, save, and reuse an audience across campaigns.
-- This migration adds exactly that as a new, standalone table.
--
-- Campaign ROI: broadcast_campaigns has no cost/budget field, so revenue
-- attributed to a campaign (already computable via message_queue's
-- metadata.campaign_id -> proposals.lead_id) has no denominator to turn
-- into ROI. `budget` is optional and operator-entered — ROI is only ever
-- computed for campaigns where a budget was actually set, never fabricated.
--
-- SCOPE:
--   - New table `marketing_segments` (saved, reusable audience filters).
--   - Two new nullable columns on `broadcast_campaigns`: `budget`,
--     `segment_id` (advisory reference to the saved segment a campaign was
--     built from — campaigns keep their own `segment` JSONB snapshot as the
--     actual source of truth used by buildSegment() at send time, so
--     editing/deleting a saved segment later never changes an existing
--     campaign's behavior).
--   - Purely additive. Does not touch any existing column, row, or query.
--
-- SAFETY:
--   - Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--   - RLS follows the exact same "service role full access" policy already
--     used by every other table in 004_phase4_campaigns.sql.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  name TEXT NOT NULL,
  description TEXT,
  filter JSONB NOT NULL DEFAULT '{}', -- SegmentFilter shape from src/lib/campaigns.ts, passed straight to buildSegment()

  created_by TEXT DEFAULT 'admin',
  last_used_at TIMESTAMPTZ,
  use_count INTEGER DEFAULT 0
);

ALTER TABLE marketing_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON marketing_segments;
CREATE POLICY "Service role full access" ON marketing_segments
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE marketing_segments IS
  'Saved, reusable audience filters (Growth Platform Phase 1 — Saved Segments). `filter` is a SegmentFilter object (src/lib/campaigns.ts) passed unchanged to buildSegment(). Segments are resolved fresh at campaign-send time, not snapshotted here, so a saved segment always reflects current data.';

ALTER TABLE broadcast_campaigns
  ADD COLUMN IF NOT EXISTS budget NUMERIC,
  ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES marketing_segments(id) ON DELETE SET NULL;

-- Postgres does not auto-index FK columns (only the referenced side is
-- indexed) — without this, the ON DELETE SET NULL cascade above and any
-- "which campaigns came from this segment" lookup would need a sequential
-- scan of broadcast_campaigns.
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_segment_id ON broadcast_campaigns(segment_id);

COMMENT ON COLUMN broadcast_campaigns.budget IS
  'Optional campaign budget in INR, set by the operator at creation. Used to compute Campaign ROI (revenue from accepted proposals attributed to this campaign via message_queue.metadata.campaign_id, divided by budget) in revenue-intelligence.ts. NULL means ROI is not computed for this campaign — never fabricated.';

COMMENT ON COLUMN broadcast_campaigns.segment_id IS
  'Optional reference to the marketing_segments row this campaign''s audience was loaded from, for traceability/analytics only. The campaign''s own `segment` JSONB (copied at creation) remains the actual filter used by buildSegment() at send time — editing or deleting the saved segment later never changes this campaign''s behavior.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT table_name FROM information_schema.tables WHERE table_name = 'marketing_segments';
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'broadcast_campaigns' AND column_name IN ('budget', 'segment_id');
--
-- Expect 1 row for the first query, 2 rows for the second.
-- ─────────────────────────────────────────────────────────────────────────────
