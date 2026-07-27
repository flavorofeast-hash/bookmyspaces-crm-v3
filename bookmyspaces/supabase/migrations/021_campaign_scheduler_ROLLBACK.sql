-- ROLLBACK for 021_campaign_scheduler.sql
-- NOTE: if any campaign currently has status 'paused' or 'cancelled', or
-- is_recurring = TRUE, restoring the narrower CHECK constraint will fail
-- (or dropping the columns will lose that data) — resolve those rows first.

DROP INDEX IF EXISTS idx_broadcast_campaigns_next_run;

ALTER TABLE broadcast_campaigns
  DROP COLUMN IF EXISTS is_recurring,
  DROP COLUMN IF EXISTS recurrence_interval,
  DROP COLUMN IF EXISTS next_run_at;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_campaigns_status_check') THEN
    ALTER TABLE broadcast_campaigns DROP CONSTRAINT broadcast_campaigns_status_check;
  END IF;

  ALTER TABLE broadcast_campaigns
    ADD CONSTRAINT broadcast_campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'running', 'completed', 'failed'));
END $$;
