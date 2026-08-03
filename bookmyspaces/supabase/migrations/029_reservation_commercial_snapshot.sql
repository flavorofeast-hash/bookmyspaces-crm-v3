-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 029: Reservation commercial snapshot (package_name, venue)
-- File  : 029_reservation_commercial_snapshot.sql
-- Runs  : AFTER 012_v3_foundation_schema.sql (extends `reservations`)
--
-- PURPOSE (Option A architecture, production-hardening pass):
-- Reservation is the commercial source of truth for every customer-facing
-- financial document once one exists (Invoice/Receipt/Payment Reminder/
-- Invoice Email — see src/lib/reservations/commercial-source.ts). Pricing
-- fields (base_room_rate, final_room_rate, discount_amount, meal_plan_charge)
-- already live on `reservations`. Two DISPLAY fields did not: package_name
-- and venue — both free text, both only ever existed on `proposals`. As a
-- result, Invoice still fell back to proposal.package_name/proposal.venue
-- even when a Reservation existed, which can show the wrong label if the
-- room/venue changed between Proposal and Reservation.
--
-- Proposal = Quotation (immutable historical document, never written to).
-- Reservation = Actual Booking (the operational record) — it must be a
-- complete, standalone snapshot, not partially dependent on reading its
-- originating Proposal for display fields forever.
--
-- SCOPE:
--   - Adds exactly two nullable TEXT columns to `reservations`.
--   - No defaults, no backfill, no data migration — purely additive.
--   - Does NOT touch `proposals` (still immutable, never written to).
--   - Does NOT rename/remove anything.
--   - Existing reservation rows get NULL for both columns; application code
--     (src/lib/reservations/commercial-source.ts) falls back to the
--     Proposal's fields when a reservation's package_name/venue is NULL —
--     see that file's comments — so this is safe for reservations created
--     before this migration.
--
-- SAFETY:
--   - Purely additive — cannot break any existing query, insert, or row.
--   - Idempotent: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS package_name TEXT,
  ADD COLUMN IF NOT EXISTS venue TEXT;

COMMENT ON COLUMN reservations.package_name IS
  'Snapshot of the package/event name at reservation creation time — copied from proposals.package_name when the reservation originates from an accepted proposal. NULL for reservations with no originating proposal (walk-in bookings). Reservation is the commercial/display source of truth once it exists; see src/lib/reservations/commercial-source.ts.';

COMMENT ON COLUMN reservations.venue IS
  'Snapshot of the venue at reservation creation time — copied from proposals.venue when the reservation originates from an accepted proposal. NULL for reservations with no originating proposal. See src/lib/reservations/commercial-source.ts.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'reservations' AND column_name IN ('package_name', 'venue');
--
-- Expect 2 rows, both TEXT, both nullable.
-- ─────────────────────────────────────────────────────────────────────────────
