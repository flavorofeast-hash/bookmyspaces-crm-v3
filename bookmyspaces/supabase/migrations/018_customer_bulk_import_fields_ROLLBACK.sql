-- ROLLBACK for migration 018.
--
-- Drops the foreign key (if it was added) and the 9 columns added by
-- 018_customer_bulk_import_fields.sql. Does not touch any other column,
-- constraint, or index on `leads`.
--
-- WARNING: if Phase 1 (Customer Bulk Import) has already gone live and any
-- of these columns hold real data, this rollback DESTROYS that data with
-- no recovery path. Check first:
--
--   SELECT COUNT(*) FROM leads
--   WHERE company IS NOT NULL OR city IS NOT NULL OR state IS NOT NULL
--      OR country IS NOT NULL OR address IS NOT NULL
--      OR date_of_visit IS NOT NULL OR birthday IS NOT NULL
--      OR anniversary IS NOT NULL OR preferred_channel IS NOT NULL
--      OR imported_via_import_id IS NOT NULL;
--
-- If this returns > 0, do not roll back without exporting/backing up that
-- data first — either export it, or don't roll back and keep migration 018
-- applied instead.

BEGIN;

-- Drop the FK first (if present) — must happen before the column that
-- carries it is dropped.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_imported_via_import_id_fkey;

ALTER TABLE leads
  DROP COLUMN IF EXISTS company,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS date_of_visit,
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS anniversary,
  DROP COLUMN IF EXISTS preferred_channel,
  DROP COLUMN IF EXISTS imported_via_import_id;

COMMIT;
