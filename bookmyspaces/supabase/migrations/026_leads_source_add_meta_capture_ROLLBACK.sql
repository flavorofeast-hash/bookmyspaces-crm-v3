-- ROLLBACK for migration 026.
--
-- Restores leads.source CHECK constraint to its migration-017 definition
-- (7 values, without the 4 Meta capture sources).
--
-- WARNING: if any leads rows have been inserted with source IN
-- ('facebook_lead_ads','instagram_lead_ads','facebook_messenger',
-- 'instagram_dm') since migration 026 was applied, this rollback will FAIL —
-- those existing rows would violate the restored, narrower constraint.
-- Check first:
--
--   SELECT source, COUNT(*) FROM leads
--   WHERE source IN ('facebook_lead_ads','instagram_lead_ads','facebook_messenger','instagram_dm')
--   GROUP BY source;
--
-- If any rows exist, decide what to do with them (e.g. UPDATE ... SET
-- source = 'other') before running this rollback.

BEGIN;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_source_check
  CHECK (source IN (
    'website',
    'whatsapp',
    'instagram',
    'justdial',
    'referral',
    'other',
    'excel_import'
  ));

COMMIT;
