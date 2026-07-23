-- ROLLBACK for migration 017.
--
-- Restores leads.source CHECK constraint to its migration-016 definition
-- (7 values, without 'excel_import').
--
-- WARNING: if any leads rows have been inserted with source = 'excel_import'
-- since migration 017 was applied (i.e. any successful Lead Import since
-- this fix shipped), this rollback will FAIL — those existing rows would
-- violate the restored, narrower constraint. Check first:
--
--   SELECT id, name, phone, email, created_at FROM leads WHERE source = 'excel_import';
--
-- If any rows are returned, either re-point them to source = 'other' before
-- rolling back, or don't roll back — keep migration 017 applied instead.
-- Rolling this back also re-breaks Lead Import (reverts to the pre-fix
-- 100%-insert-failure state) unless the app-code fix in
-- src/app/api/leads/import/route.ts is reverted at the same time.

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
    'proposal'
  ));

COMMIT;
