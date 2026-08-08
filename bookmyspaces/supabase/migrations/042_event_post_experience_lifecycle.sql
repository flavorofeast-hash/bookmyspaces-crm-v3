-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 042: Event Post-Experience Lifecycle
-- File  : 042_event_post_experience_lifecycle.sql
-- Runs  : AFTER 033_review_engine.sql (review_requests, UNIQUE(reservation_id))
--         AND AFTER 035_loyalty_foundation.sql (loyalty_transactions,
--         idx_loyalty_transactions_reservation_award)
--
-- PURPOSE:
-- The stay-lifecycle cron's post-stay thank-you / review-request / loyalty
-- award only ever fires for `reservations` (room stays). An accepted event
-- proposal (wedding, birthday, corporate, rooftop event) with no linked
-- reservation (`proposals.reservation_id IS NULL`) never enters that
-- lifecycle at all — confirmed by a full read of stay-lifecycle/route.ts
-- and a negative grep for reservation-creation side effects in
-- proposal-service.ts before writing this migration.
--
-- This migration adds the two idempotency backstops the new event branch
-- needs, mirroring the reservation-side ones exactly rather than inventing
-- a new pattern:
--   1. review_requests.proposal_id — same role as the existing
--      reservation_id column, so an event-sourced review request is
--      tracked (and automatically picked up by the existing
--      /api/cron/review-reminders cron, which already filters on
--      status/reminder_count only, not on reservation_id being set).
--   2. idx_loyalty_transactions_proposal_award — same role as the existing
--      idx_loyalty_transactions_reservation_award partial unique index, so
--      awardPoints({referenceType:'proposal', referenceId}) is safe to
--      re-run without double-awarding, exactly like the reservation path.
--
-- SCOPE: one new nullable column + one new unique index on review_requests,
-- one new partial unique index on loyalty_transactions. Purely additive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL;

COMMENT ON COLUMN review_requests.proposal_id IS
  'Link to the accepted event proposal this review request is about, for bookings with no associated reservation (events). Mutually exclusive with reservation_id in practice — a request is sourced from either a stay or an event, never both.';

-- Mirrors the existing UNIQUE(reservation_id) constraint: makes a re-run of
-- the event-lifecycle cron on the same day safe (23505 -> no-op) instead of
-- inserting a second review request for the same event. NULLs (reservation-
-- sourced rows) are unaffected — a UNIQUE index permits any number of NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_requests_proposal_id
  ON review_requests(proposal_id);

-- Mirrors idx_loyalty_transactions_reservation_award for the event path —
-- makes awardPoints({referenceType:'proposal', referenceId: proposal.id})
-- idempotent at the database level, not just via application-side checks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_transactions_proposal_award
  ON loyalty_transactions(reference_id)
  WHERE reference_type = 'proposal';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'review_requests' AND column_name = 'proposal_id';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'review_requests' AND indexname = 'idx_review_requests_proposal_id';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'loyalty_transactions' AND indexname = 'idx_loyalty_transactions_proposal_award';
-- Expect 1 row each.
-- ─────────────────────────────────────────────────────────────────────────────
