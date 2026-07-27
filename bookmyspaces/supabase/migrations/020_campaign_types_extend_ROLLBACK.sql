-- ROLLBACK for 020_campaign_types_extend.sql
-- Restores the original 004 CHECK constraint. NOTE: if any
-- birthday/anniversary/dormant campaigns were created while the extended
-- constraint was live, this rollback will fail (existing rows violate the
-- narrower constraint) — resolve/delete those rows first if rolling back.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_campaigns_type_check'
  ) THEN
    ALTER TABLE broadcast_campaigns DROP CONSTRAINT broadcast_campaigns_type_check;
  END IF;

  ALTER TABLE broadcast_campaigns
    ADD CONSTRAINT broadcast_campaigns_type_check
    CHECK (type IN ('festival', 'followup', 'reengagement', 'offer', 'review_request', 'custom'));
END $$;
