-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 037: Social + WhatsApp Growth (Phase 2)
-- File  : 037_social_growth_phase2.sql
-- Runs  : AFTER 014_social_foundation.sql (social_posts), AFTER
--         034_referral_engine.sql / 035_loyalty_foundation.sql (numeric order)
--
-- PURPOSE:
--   1. social_post_metrics — Phase A Engagement Analytics (reach, impressions,
--      clicks, likes, comments, shares, saves) as a per-post cache row, kept
--      current by an explicit sync job (src/lib/social/metrics-service.ts)
--      that calls SocialAdapter.fetchEngagementMetrics() — never fabricated
--      when no adapter is configured, the row simply never updates.
--   2. drip_sequences / drip_sequence_steps / drip_sequence_enrollments —
--      Phase B multi-step, delay-based WhatsApp/email sequences, distinct
--      from a single broadcast_campaigns send. The ledger/enrollment model
--      mirrors the loyalty_transactions / referral_rewards precedent already
--      in this codebase: one FOUNDATION set of tables, application code
--      (src/lib/whatsapp/drip-service.ts) owns the actual advancement logic.
--
-- SCOPE: four new, standalone tables. Purely additive — no existing table,
-- column, or query is touched.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Phase A: Engagement Analytics ──────────────────────────────────────────
-- One row per post (UNIQUE(post_id)), upserted by metrics-service.ts. A
-- snapshot cache, not a time series — matches loyalty_accounts' own
-- "cached current value, ledger elsewhere if history is ever needed" choice.
CREATE TABLE IF NOT EXISTS social_post_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,

  reach INTEGER,
  impressions INTEGER,
  clicks INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,

  -- 'manual' = operator-entered (no adapter configured for the platform yet);
  -- 'adapter_sync' = fetched live via SocialAdapter.fetchEngagementMetrics().
  -- Never fabricated either way — NULL columns above mean "not known", not zero.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'adapter_sync')),

  UNIQUE(post_id)
);

DROP TRIGGER IF EXISTS update_social_post_metrics_updated_at ON social_post_metrics;
CREATE TRIGGER update_social_post_metrics_updated_at
  BEFORE UPDATE ON social_post_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE social_post_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON social_post_metrics;
CREATE POLICY "Service role full access" ON social_post_metrics
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE social_post_metrics IS
  'Per-post engagement analytics cache (Phase A). One row per social_posts row, upserted by metrics-service.ts. NULL means "not measured yet" — never a fabricated zero. source=manual until a real platform adapter is configured, then adapter_sync.';

-- ── Phase B: Drip Sequences ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drip_sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  name TEXT NOT NULL,
  description TEXT,
  -- 'manual' = operator enrolls leads by hand; the others are recognized
  -- trigger points the application layer may enroll a lead against
  -- automatically in a future pass — this migration only defines the values,
  -- it does not wire any automatic enrollment itself.
  trigger_event TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_event IN (
    'manual', 'new_lead', 'proposal_sent', 'post_stay', 'dormant'
  )),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT DEFAULT 'admin'
);

DROP TRIGGER IF EXISTS update_drip_sequences_updated_at ON drip_sequences;
CREATE TRIGGER update_drip_sequences_updated_at
  BEFORE UPDATE ON drip_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE drip_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON drip_sequences;
CREATE POLICY "Service role full access" ON drip_sequences
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE drip_sequences IS
  'Multi-step WhatsApp/email sequence definitions (Phase B), distinct from a single broadcast_campaigns send. Steps live in drip_sequence_steps; per-lead progress in drip_sequence_enrollments.';

CREATE TABLE IF NOT EXISTS drip_sequence_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  sequence_id UUID NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL CHECK (step_order >= 1),
  -- Days after the PREVIOUS step (or enrollment, for step 1) before this
  -- step sends. 0 = same day as the previous step/enrollment.
  delay_days INTEGER NOT NULL DEFAULT 1 CHECK (delay_days >= 0),
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email')),
  -- Same {{name}} placeholder convention as broadcast_campaigns.message_template.
  message_template TEXT NOT NULL,

  UNIQUE(sequence_id, step_order)
);

ALTER TABLE drip_sequence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON drip_sequence_steps;
CREATE POLICY "Service role full access" ON drip_sequence_steps
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE drip_sequence_steps IS
  'Ordered steps within a drip_sequences row (Phase B). delay_days is relative to the previous step (or enrollment, for step 1) — the drip cron computes each enrollment''s next_send_at from this.';

CREATE TABLE IF NOT EXISTS drip_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  sequence_id UUID NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- 0 = enrolled, no step sent yet. N = step N was the last one sent.
  current_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  next_send_at TIMESTAMPTZ,

  -- A lead can only have ONE active/completed enrollment per sequence at a
  -- time — re-enrolling requires the existing row to be cancelled first
  -- (prevents accidental duplicate enrollment from a double form-submit).
  UNIQUE(sequence_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_due ON drip_sequence_enrollments(status, next_send_at);

DROP TRIGGER IF EXISTS update_drip_sequence_enrollments_updated_at ON drip_sequence_enrollments;
CREATE TRIGGER update_drip_sequence_enrollments_updated_at
  BEFORE UPDATE ON drip_sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE drip_sequence_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON drip_sequence_enrollments;
CREATE POLICY "Service role full access" ON drip_sequence_enrollments
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE drip_sequence_enrollments IS
  'Per-lead progress through a drip_sequences row (Phase B). next_send_at is computed by src/lib/whatsapp/drip-service.ts from the enrolled/last-sent timestamp plus the next step''s delay_days; the drip cron drains rows where next_send_at <= now().';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('social_post_metrics', 'drip_sequences', 'drip_sequence_steps', 'drip_sequence_enrollments');
-- Expect 4 rows.
-- ─────────────────────────────────────────────────────────────────────────────
