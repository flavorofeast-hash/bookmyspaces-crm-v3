-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027 — Site Visit fields on `follow_ups`
--
-- Sprint 1 (Revenue Capture Pipeline) — "Visit Scheduling" step: Landing Page
-- -> AI Conversation -> Lead Created -> Visit Scheduled -> Proposal.
--
-- Reuses the existing `follow_ups` table rather than a new one: it already
-- has a `type` CHECK constraint that includes 'site_visit'
-- (007_missing_tables.sql:30, live since that migration — this value has
-- simply never had a writer until now), plus lead_id, scheduled_at, status,
-- and notes, which already cover Customer/Mobile (via the lead_id join),
-- Date+Time (scheduled_at), Status, and free-form detail. The four columns
-- below are the ones follow_ups doesn't already have: Property, Purpose,
-- Guest Count, and Budget, all specific to a site-visit appointment and not
-- meaningful for follow_ups' other types (call/whatsapp/email/proposal).
--
-- Additive only, per MASTER_DATABASE.md's Database Evolution Policy:
-- all four columns nullable, no existing column touched, no rename/drop,
-- idempotent (IF NOT EXISTS), paired ROLLBACK file. Not a new table, so no
-- stop-and-explain is required under this sprint's engineering rules.
--
-- `budget` is TEXT, matching leads.budget's existing convention
-- (001_initial_schema.sql) — free-text budget ranges like "1.5-2L", not a
-- parsed numeric.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS property    TEXT,     -- 'Monurama Homestay' | 'Skyline Serenity' | free text
  ADD COLUMN IF NOT EXISTS purpose     TEXT,     -- e.g. 'Wedding site visit — Rooftop'
  ADD COLUMN IF NOT EXISTS guest_count INTEGER,
  ADD COLUMN IF NOT EXISTS budget      TEXT;

CREATE INDEX IF NOT EXISTS idx_follow_ups_type_scheduled_at
  ON follow_ups(type, scheduled_at)
  WHERE type = 'site_visit';

COMMENT ON COLUMN follow_ups.property IS 'Migration 027 — site-visit appointments only. NULL for other follow_ups.type values.';
COMMENT ON COLUMN follow_ups.purpose IS 'Migration 027 — site-visit appointments only. Short human-readable reason for the visit.';
COMMENT ON COLUMN follow_ups.guest_count IS 'Migration 027 — site-visit appointments only. Carried from the lead at scheduling time, may differ from leads.guest_count if updated later.';
COMMENT ON COLUMN follow_ups.budget IS 'Migration 027 — site-visit appointments only. TEXT, same free-text convention as leads.budget.';
