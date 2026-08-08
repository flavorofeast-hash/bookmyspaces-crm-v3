-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 040_social_connectivity_and_attribution.sql
--
-- Drops ad_spend entirely (destructive — any recorded spend rows are lost;
-- export first if needed), drops leads.merged_into_lead_id (fails if you
-- want to preserve merge history — none is preserved by this rollback),
-- and drops social_accounts.refresh_token_encrypted (any stored refresh
-- tokens are lost — affected accounts will need to be reconnected via
-- OAuth to resume automatic token renewal).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS ad_spend;

DROP INDEX IF EXISTS idx_leads_merged_into_lead_id;
ALTER TABLE leads DROP COLUMN IF EXISTS merged_into_lead_id;

ALTER TABLE social_accounts DROP COLUMN IF EXISTS refresh_token_encrypted;

COMMIT;
