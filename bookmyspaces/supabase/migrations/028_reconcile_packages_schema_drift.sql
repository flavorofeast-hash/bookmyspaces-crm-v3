-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 028 — Reconcile `packages` schema drift (Strategy B).
--
-- BACKGROUND: MASTER_DATABASE.md's "one rule that matters most" and
-- scripts/verify-packages-columns.sql document a confirmed live/migration-file
-- drift on `packages` (RC1 finding, BUG-003/ENG-035): production has been
-- observed using `property`, `price`, `capacity_max`, while migrations
-- 007/023/024 and every application read/write (package-service.ts's
-- mapPackageRow/createPackage/updatePackage, the WhatsApp pricing reply,
-- getActivePackagePrices(), AI context, the Property Intelligence guard in
-- auto-package-recommendation.ts, the Smart Proposal Generator) all use
-- `venue`, `base_price`, `max_guests` by name. The application schema
-- (migration files + every reader) is the source of truth per this mission;
-- this migration reconciles the live table to it — not the other way round.
--
-- STRATEGY: ALTER TABLE ... RENAME COLUMN, not add-new-column-and-backfill.
-- A rename preserves the column's data, type, default, and NOT NULL/CHECK
-- constraints for free (Postgres tracks columns by internal attribute number,
-- not name), and any index or FK expression referencing the old name is
-- transparently repointed at the new one — so "preserve data / constraints /
-- FKs / triggers / defaults" all fall out of using RENAME COLUMN instead of
-- creating parallel columns. No new columns are created, no data is copied
-- into a temp column.
--
-- SCOPE: exactly the 3 column pairs confirmed by
-- scripts/verify-packages-columns.sql and this mission's verification report
-- (`property`→`venue`, `price`→`base_price`, `capacity_max`→`max_guests`).
-- Other live-only columns reportedly seen on `packages` in an earlier ad hoc
-- seed-data pass (`slug`, `type`, `price_note`, `duration`, `capacity_min`,
-- `sort_order` — see supabase/seed/rc1_catalog_test_seed.sql's header) are
-- OUT OF SCOPE here: they were never part of the confirmed verification this
-- mission is scoped to, no application code reads or writes them, and
-- guessing at a rename for columns whose current live existence isn't
-- confirmed by this mission's evidence would violate "keep the migration as
-- small and reversible as possible." See the deployment report's Risks
-- section for the recommended follow-up verification before this is
-- considered fully closed.
--
-- IDEMPOTENT / DUAL-SAFE: each rename is guarded so this migration is a
-- no-op wherever the target column already exists (covers three real cases —
-- (a) a fresh install where 007/023/024 already created venue/base_price/
-- max_guests directly, (b) re-running this migration a second time, and
-- (c) the drifted production table this migration exists to fix).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'property'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'venue'
  ) THEN
    ALTER TABLE packages RENAME COLUMN property TO venue;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'price'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'base_price'
  ) THEN
    ALTER TABLE packages RENAME COLUMN price TO base_price;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'capacity_max'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'max_guests'
  ) THEN
    ALTER TABLE packages RENAME COLUMN capacity_max TO max_guests;
  END IF;
END $$;

-- Recreate the venue index if it isn't already present under the new column
-- name. Migration 007 defines `idx_packages_venue ON packages(venue)`; on the
-- drifted live table that index could not have existed (the `venue` column
-- didn't exist to index), so it must be (re)created explicitly here rather
-- than assumed to have followed the rename automatically.
CREATE INDEX IF NOT EXISTS idx_packages_venue ON packages(venue);

-- No new index is needed for base_price/max_guests — migration 007 never
-- indexed those columns under either name, so there is nothing to recreate.

-- Constraints, FKs, triggers (update_packages_updated_at), and RLS policies
-- (packages_service_role_all, packages_anon_read) are all role- or
-- table-level, not column-name-level, and a RENAME COLUMN does not disturb
-- them — no further action needed for those to remain intact.
