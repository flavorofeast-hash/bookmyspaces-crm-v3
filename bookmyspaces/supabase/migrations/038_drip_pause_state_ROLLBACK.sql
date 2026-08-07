-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 038_drip_pause_state.sql
-- Restores the original 3-value CHECK constraint. Any row currently
-- 'paused' must be moved to 'active' or 'cancelled' first, or this will
-- fail — deliberately not force-rewriting data on rollback.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE drip_sequence_enrollments
  DROP CONSTRAINT IF EXISTS drip_sequence_enrollments_status_check;

ALTER TABLE drip_sequence_enrollments
  ADD CONSTRAINT drip_sequence_enrollments_status_check
  CHECK (status IN ('active', 'completed', 'cancelled'));

COMMIT;
