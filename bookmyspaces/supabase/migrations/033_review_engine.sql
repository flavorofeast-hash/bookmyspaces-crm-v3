-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 033: Review Engine (request tracking)
-- File  : 033_review_engine.sql
-- Runs  : AFTER 014_social_foundation.sql (extends `reviews`, adds
--         `review_requests`) AND AFTER 012_v3_foundation_schema.sql
--         (reviews.reservation_id references `reservations`)
--
-- PURPOSE (Growth Engine Epic 1 — Review Engine):
-- `reviews` (migration 014) models an ALREADY-POSTED external review
-- (platform, rating, content, response_draft/status) — it has no concept of
-- an outbound "we asked this guest for a review" request, and its
-- `platform` CHECK ('google','facebook','booking','other') correctly
-- excludes an internal request channel like 'whatsapp'. Reusing that column
-- for requests would either violate the CHECK or misrepresent a request as
-- a posted review. This migration REUSES `reviews` as-is for actual review
-- content (adds one traceability column only) and adds a new, small
-- `review_requests` table for the ask/reminder workflow — the piece that
-- was genuinely missing, not a duplicate of `reviews`.
--
-- `/api/cron/stay-lifecycle` already sends ONE review-request WhatsApp
-- message 3 days post-checkout (journey: 'review_request' in
-- message_queue.metadata) but never persisted that a request happened —
-- confirmed by grep, zero writes to any review-tracking table before this
-- migration. This closes that gap so requests can be tracked, reminded
-- once, and reported on.
--
-- SCOPE: one new table, one new nullable column on `reviews`. Purely
-- additive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL;

COMMENT ON COLUMN reviews.reservation_id IS
  'Optional link to the stay this review is about, when known (matched manually at entry time — no external review API exists to auto-match). NULL for reviews that can''t be tied to a specific reservation.';

CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'reminded', 'completed', 'declined')),

  requested_at TIMESTAMPTZ DEFAULT NOW(),
  reminder_count INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,

  -- Set once a matching review is manually logged via POST /api/reviews
  -- (operator links it back), or left NULL indefinitely — there is no
  -- external API to auto-detect that a requested review was posted.
  review_id UUID REFERENCES reviews(id) ON DELETE SET NULL,

  UNIQUE(reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(status);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON review_requests;
CREATE POLICY "Service role full access" ON review_requests
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE review_requests IS
  'Outbound review-ask tracking (Growth Engine Epic 1) — when a guest was asked for a review, whether they were reminded, and whether it resulted in a logged review. Distinct from `reviews`, which holds actual review content.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT table_name FROM information_schema.tables WHERE table_name = 'review_requests';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'reviews' AND column_name = 'reservation_id';
-- Expect 1 row each.
-- ─────────────────────────────────────────────────────────────────────────────
