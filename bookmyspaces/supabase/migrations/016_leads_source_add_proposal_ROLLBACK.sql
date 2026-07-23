-- ROLLBACK for migration 016.
--
-- Restores leads.source CHECK constraint to its original
-- 001_initial_schema.sql definition (6 values, without 'proposal').
--
-- WARNING: if any leads rows have been inserted with source = 'proposal'
-- since migration 016 was applied, this rollback will FAIL — those existing
-- rows would violate the restored, narrower constraint. Check first:
--
--   SELECT id, name, phone, email, created_at FROM leads WHERE source = 'proposal';
--
-- If any rows are returned, either re-point them to source = 'other' before
-- rolling back, or don't roll back — keep migration 016 applied instead.

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
    'other'
  ));

COMMIT;
