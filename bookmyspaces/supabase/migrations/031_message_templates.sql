-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 031: Message Templates (WhatsApp + Email)
-- File  : 031_message_templates.sql
-- Runs  : AFTER 004_phase4_campaigns.sql
--
-- PURPOSE (Growth Platform Phase 3 — AI Content Studio: WhatsApp Campaign
-- Templates, Email Templates):
-- broadcast_campaigns.message_template is free text typed fresh per
-- campaign every time — there is nowhere to save a reusable message for
-- future campaigns (distinct from `marketing_segments`, migration 030,
-- which saves the AUDIENCE, not the message). This table saves the
-- MESSAGE side, for both channels already named in broadcast_campaigns.
-- channel (whatsapp/email) but only WhatsApp currently sends — email
-- templates are content-only scaffolding for when email sending is built,
-- per this phase's explicit instruction not to integrate a new send
-- channel yet, only to design so it can be added without redesign.
--
-- SCOPE: one new, standalone, purely additive table. Does not touch
-- broadcast_campaigns or any existing table.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email')),
  category TEXT, -- optional free-text label, e.g. 'festival' / 'offer' / 'review_request' — for the operator's own organization, not a hard enum
  subject TEXT,  -- email only; NULL for whatsapp templates
  body TEXT NOT NULL, -- may contain {{name}} placeholder, same convention as broadcast_campaigns.message_template

  created_by TEXT DEFAULT 'admin',
  last_used_at TIMESTAMPTZ,
  use_count INTEGER DEFAULT 0
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON message_templates;
CREATE POLICY "Service role full access" ON message_templates
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE message_templates IS
  'Saved, reusable campaign message content (Growth Platform Phase 3). channel=email rows are content-only — no email send path exists yet; body/subject are stored so content can be authored ahead of that integration without a schema change later.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT: SELECT table_name FROM information_schema.tables WHERE table_name = 'message_templates';
-- Expect 1 row.
-- ─────────────────────────────────────────────────────────────────────────────
