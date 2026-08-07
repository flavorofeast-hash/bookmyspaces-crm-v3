-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 038: Drip Sequence Pause/Resume State
-- File  : 038_drip_pause_state.sql
-- Runs  : AFTER 037_social_growth_phase2.sql (drip_sequence_enrollments)
--
-- PURPOSE:
--   Phase 3 (Revenue Automation) — WhatsApp Drip Campaigns needed a
--   pause/resume control the original Phase 2 schema didn't allow: the
--   enrollment status CHECK only permitted ('active','completed','cancelled').
--   Adds 'paused' as a fourth allowed value — src/lib/whatsapp/drip-service.ts
--   pauseEnrollment()/resumeEnrollment() write it; advanceDueDripSteps()
--   only ever selects status='active', so a paused enrollment is already,
--   for free, excluded from being drained — no other query needed changing.
--
-- SCOPE: one CHECK constraint widened on one existing table. Purely
-- additive — no column added, no existing row touched, no other table
-- affected.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE drip_sequence_enrollments
  DROP CONSTRAINT IF EXISTS drip_sequence_enrollments_status_check;

ALTER TABLE drip_sequence_enrollments
  ADD CONSTRAINT drip_sequence_enrollments_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'cancelled'));

COMMENT ON COLUMN drip_sequence_enrollments.status IS
  'active = draining normally; paused = operator-paused, excluded from advanceDueDripSteps() until resumed; completed = all steps sent; cancelled = manually cancelled or exited early (e.g. lead converted).';

COMMIT;
