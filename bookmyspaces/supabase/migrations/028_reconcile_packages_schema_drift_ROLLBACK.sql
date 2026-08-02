-- ROLLBACK for 028_reconcile_packages_schema_drift.sql
--
-- Renames the 3 columns back to the pre-migration live names
-- (venue→property, base_price→price, max_guests→capacity_max). Guarded the
-- same way as the forward migration: a no-op wherever the old name doesn't
-- exist or the target name is already taken, so this is safe to run even if
-- 028 only partially applied (e.g. the table already matched the app schema
-- before 028 ran, so some/all renames in 028 were no-ops themselves).
--
-- NOTE on idx_packages_venue: 028 creates this index if missing. Postgres
-- indexes are not named after their columns internally, so after this
-- rollback renames venue back to property, an index literally named
-- `idx_packages_venue` may remain in place, now indexing the `property`
-- column. This is left as-is rather than dropped: there is no reliable way
-- for this rollback to tell whether 028 created that index or whether it
-- already existed before 028 ran, and dropping an index that predates 028
-- would violate this repo's rollback convention of only undoing what the
-- forward migration itself did. If an exact pre-028 index state is required,
-- verify against information_schema.indexes on the live database first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'venue'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'property'
  ) THEN
    ALTER TABLE packages RENAME COLUMN venue TO property;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'base_price'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'price'
  ) THEN
    ALTER TABLE packages RENAME COLUMN base_price TO price;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'max_guests'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'capacity_max'
  ) THEN
    ALTER TABLE packages RENAME COLUMN max_guests TO capacity_max;
  END IF;
END $$;
