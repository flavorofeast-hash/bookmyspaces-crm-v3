-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 — Campaign Landing Page attribution fields on `leads`
--
-- Sprint 1 (Revenue Capture Engine / Campaign Landing Page System). Adds the
-- attribution fields the landing-page capture flow needs to record per
-- MASTER_DATABASE.md's Database Evolution Policy: additive only, idempotent,
-- no rename/drop, paired ROLLBACK file. Reuses the existing `leads` table
-- (single source of truth for contacts) rather than introducing a new table —
-- this is attribution data about an existing lead concept, not a new entity.
--
-- `leads.source` already accepts free text (see 016/017 migrations) — 'campaign'
-- is a new but backward-compatible value, not a new column.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS campaign     TEXT,  -- landing-page campaign slug, e.g. 'wedding'
  ADD COLUMN IF NOT EXISTS landing_page TEXT,  -- pathname visitor landed on, e.g. '/wedding'
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS referral     TEXT;  -- free-text referral source/code, distinct from source='referral' status
