-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 040: Social Connectivity + Revenue Attribution
-- File  : 040_social_connectivity_and_attribution.sql
-- Runs  : AFTER 039_social_growth_phase4.sql
--
-- PURPOSE:
--   1. social_accounts.refresh_token_encrypted — Social Connectivity
--      Priority 1 (OAuth token refresh rotation). LinkedIn/Google
--      Business/X issue a refresh_token on the standard OAuth2 grant;
--      Facebook/Instagram do not (long-lived-token re-exchange instead,
--      see src/lib/social/oauth/refresh-service.ts) so this column is
--      nullable and simply unused for those two platforms. Encrypted at
--      rest with the same AES-256-GCM token-cipher.ts already used for
--      access_token_encrypted — no new crypto, no new pattern.
--   2. leads.merged_into_lead_id — Social Operations Priority 4 (duplicate
--      lead prevention / identity resolution merge). NULL = not merged
--      (the default, current state of every existing row). When set,
--      points at the surviving lead this row was merged into.
--      ON DELETE SET NULL — deleting the surviving lead must never cascade-
--      delete the merged-away historical row.
--   3. ad_spend — Marketing Intelligence Priority 3 (ad spend ingestion for
--      Cost per Enquiry / Cost per Booking / ROI). New table; no existing
--      table stores spend anywhere in this schema (confirmed by repo-wide
--      search before writing this migration). Manual entry now
--      (source='manual'), same shape ready for a future ad-platform API
--      ingestion job (source='meta_ads'/'google_ads') without a schema
--      change — only the source value changes.
--
-- SCOPE: one column added to social_accounts, one column added to leads,
-- one new table created. Purely additive — no existing row touched, no
-- existing column/table altered or dropped.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;

COMMENT ON COLUMN social_accounts.refresh_token_encrypted IS
  'AES-256-GCM encrypted (token-cipher.ts), same convention as access_token_encrypted. NULL for platforms with no refresh_token grant (facebook, instagram — renewed via long-lived-token re-exchange instead, see oauth/refresh-service.ts) and for any account not yet re-connected since this column was added.';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS merged_into_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_merged_into_lead_id ON leads(merged_into_lead_id) WHERE merged_into_lead_id IS NOT NULL;

COMMENT ON COLUMN leads.merged_into_lead_id IS
  'NULL = active, standalone lead (default/current state of every existing row). Set by lead-merge-service.ts mergeLeads() when this lead is identified as a duplicate and merged into another — points at the surviving lead. Existing queries that do not filter on this column are unaffected (additive, defaults to NULL).';

CREATE TABLE IF NOT EXISTS ad_spend (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  platform TEXT NOT NULL CHECK (platform IN (
    'facebook', 'instagram', 'linkedin', 'google_business', 'x', 'youtube', 'threads', 'google_ads', 'other'
  )),
  campaign_name TEXT,
  spend_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'meta_ads', 'google_ads')),
  notes TEXT,
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_ad_spend_platform_date ON ad_spend(platform, spend_date);
CREATE INDEX IF NOT EXISTS idx_ad_spend_campaign_name ON ad_spend(campaign_name) WHERE campaign_name IS NOT NULL;

COMMENT ON TABLE ad_spend IS
  'Marketing Intelligence Priority 3 — manual (or future API-ingested) ad spend records, joined against acquisition/campaign performance in ad-spend-service.ts to compute cost per enquiry / cost per booking / ROI without modifying revenue-intelligence.ts.';

ALTER TABLE ad_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_spend_service_role_all" ON ad_spend;
CREATE POLICY "ad_spend_service_role_all" ON ad_spend
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'social_accounts' AND column_name = 'refresh_token_encrypted';
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'leads' AND column_name = 'merged_into_lead_id';
--   SELECT table_name FROM information_schema.tables WHERE table_name = 'ad_spend';
-- Expect 1 row each.
-- ─────────────────────────────────────────────────────────────────────────────
