-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 021 — Campaign Scheduler support.
--
-- WHY: Priority 3 (Marketing Intelligence) requires pause/resume/cancel and
-- recurring campaigns. Audit found:
--   - broadcast_campaigns.status CHECK (migration 004) only allows
--     draft/scheduled/running/completed/failed — no way to represent a
--     paused or cancelled campaign without this migration.
--   - No recurrence fields exist at all — recurring campaigns are a
--     genuinely new capability, not a disconnected one.
--   - message_queue (migration 002) already supports scheduled_at + status
--     tracking and just needs a 'cancelled' equivalent — reusing the
--     existing 'skipped' status for that (see src/lib/queue.ts) avoids a
--     second schema change on a table this migration doesn't otherwise
--     touch.
--
-- Additive and idempotent; ROLLBACK file alongside.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_campaigns_status_check') THEN
    ALTER TABLE broadcast_campaigns DROP CONSTRAINT broadcast_campaigns_status_check;
  END IF;

  ALTER TABLE broadcast_campaigns
    ADD CONSTRAINT broadcast_campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'));
END $$;

ALTER TABLE broadcast_campaigns
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence_interval TEXT CHECK (recurrence_interval IN ('daily', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_next_run ON broadcast_campaigns(next_run_at) WHERE is_recurring = TRUE;
