-- Rollback for 026_campaign_landing_attribution.sql
ALTER TABLE leads
  DROP COLUMN IF EXISTS campaign,
  DROP COLUMN IF EXISTS landing_page,
  DROP COLUMN IF EXISTS utm_source,
  DROP COLUMN IF EXISTS utm_medium,
  DROP COLUMN IF EXISTS utm_campaign,
  DROP COLUMN IF EXISTS referral;
