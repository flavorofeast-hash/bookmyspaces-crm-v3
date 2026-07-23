-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 018: Customer Bulk Import fields
-- File  : 018_customer_bulk_import_fields.sql
--
-- PURPOSE: adds the 9 columns approved in Migration Proposal 018 (Phase 1 —
-- Customer Bulk Import), derived from a live production column inventory,
-- not from prior migration files. See:
--   - audit/CUSTOMER_DATA_MANAGEMENT_MARKETING_HUB_DESIGN.md
--   - the Phase 1 Customer Field Inventory (this session)
--
-- SCOPE — deliberately narrow:
--   - Adds exactly 9 columns to `leads`: company, city, state, country,
--     address, date_of_visit, birthday, anniversary, preferred_channel,
--     imported_via_import_id.
--   - Does NOT modify, rename, or drop any existing column.
--   - Does NOT modify any existing CHECK constraint (leads_source_check,
--     or the absent leads_status_check — neither is touched).
--   - Does NOT modify any existing index (leads_phone_unique, idx_leads_phone,
--     or any other).
--   - Does NOT touch `leads.date` — confirmed unused by any code path this
--     session (see investigation notes in the approved Migration Proposal
--     018 discussion); left completely as-is.
--   - Does NOT add `imported_from_customer_import` — removed from the
--     proposal as redundant; `imported_via_import_id` alone provides
--     traceability, reporting, and rollback identification.
--   - Does NOT add a CHECK constraint on `preferred_channel` — stays plain
--     TEXT, validated at the application layer only, per instruction.
--   - The foreign key on `imported_via_import_id` is added ONLY if
--     `lead_imports` and `lead_imports.id` are confirmed present at
--     migration time (Section 2 below) — never assumed.
--
-- SAFETY:
--   - Purely additive. Cannot reject or alter any existing row.
--   - Idempotent: every ADD COLUMN uses IF NOT EXISTS; the FK step checks
--     for its own prior existence before adding; safe to re-run.
--   - Same pattern as migrations 003/004/008 (additive ADD COLUMN) and the
--     self-guarding DO-block style introduced this session for
--     PRODUCTION_VERIFICATION_LEADS.sql's Section H.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT — run first, confirm none of these 9 columns already exist.
-- Expected: zero rows returned. If any row comes back, STOP and report
-- before proceeding — do not assume this migration is still needed as-is.
--
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'leads'
--     AND column_name IN (
--       'company', 'city', 'state', 'country', 'address',
--       'date_of_visit', 'birthday', 'anniversary',
--       'preferred_channel', 'imported_via_import_id'
--     );
-- ─────────────────────────────────────────────────────────────────────────────

-- SECTION 1: ADD COLUMNS
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS date_of_visit DATE,
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS anniversary DATE,
  ADD COLUMN IF NOT EXISTS preferred_channel TEXT,
  ADD COLUMN IF NOT EXISTS imported_via_import_id UUID;

COMMIT;


-- SECTION 2: CONDITIONAL FOREIGN KEY — self-guarding, never fails the
-- migration. Adds leads.imported_via_import_id -> lead_imports.id ONLY if
-- both the table and the column are confirmed present; otherwise leaves
-- imported_via_import_id as a plain, unconstrained UUID column and says so.
DO $$
DECLARE
  ref_table_exists     boolean;
  ref_column_exists    boolean;
  ref_column_is_uuid   boolean;
  ref_column_is_unique boolean;
  fk_already_exists    boolean;
BEGIN
  -- Check 1: lead_imports exists.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lead_imports'
  ) INTO ref_table_exists;

  IF NOT ref_table_exists THEN
    RAISE NOTICE 'MIGRATION 018: lead_imports table not found in public schema — leads.imported_via_import_id added WITHOUT a foreign key. Re-run this migration after lead_imports exists to add the FK.';
    RETURN;
  END IF;

  -- Check 2: lead_imports.id exists.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_imports' AND column_name = 'id'
  ) INTO ref_column_exists;

  IF NOT ref_column_exists THEN
    RAISE NOTICE 'MIGRATION 018: lead_imports.id not found — leads.imported_via_import_id added WITHOUT a foreign key.';
    RETURN;
  END IF;

  -- Check 3: lead_imports.id is type uuid (must match imported_via_import_id's type).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_imports'
      AND column_name = 'id' AND data_type = 'uuid'
  ) INTO ref_column_is_uuid;

  IF NOT ref_column_is_uuid THEN
    RAISE NOTICE 'MIGRATION 018: lead_imports.id exists but is not type uuid — leads.imported_via_import_id added WITHOUT a foreign key (type mismatch would make the constraint invalid).';
    RETURN;
  END IF;

  -- Check 4: lead_imports.id is covered by a single-column PRIMARY KEY or
  -- UNIQUE constraint — Postgres requires the referenced column(s) to be
  -- unique on their own, not merely part of a composite unique constraint,
  -- for a single-column foreign key like this one to be valid.
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'lead_imports'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      AND kcu.column_name = 'id'
      AND (
        SELECT COUNT(*) FROM information_schema.key_column_usage kcu2
        WHERE kcu2.constraint_name = tc.constraint_name
          AND kcu2.table_schema = tc.table_schema
      ) = 1
  ) INTO ref_column_is_unique;

  IF NOT ref_column_is_unique THEN
    RAISE NOTICE 'MIGRATION 018: lead_imports.id is not a single-column PRIMARY KEY or UNIQUE constraint — leads.imported_via_import_id added WITHOUT a foreign key (Postgres requires a unique target).';
    RETURN;
  END IF;

  -- All four conditions satisfied — safe to add the FK. Still idempotent:
  -- check for its own prior existence first.
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_imported_via_import_id_fkey'
  ) INTO fk_already_exists;

  IF fk_already_exists THEN
    RAISE NOTICE 'MIGRATION 018: leads_imported_via_import_id_fkey already exists — skipped (idempotent re-run).';
  ELSE
    ALTER TABLE leads
      ADD CONSTRAINT leads_imported_via_import_id_fkey
      FOREIGN KEY (imported_via_import_id) REFERENCES lead_imports(id);
    RAISE NOTICE 'MIGRATION 018: leads_imported_via_import_id_fkey added successfully.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'leads'
--     AND column_name IN (
--       'company', 'city', 'state', 'country', 'address',
--       'date_of_visit', 'birthday', 'anniversary',
--       'preferred_channel', 'imported_via_import_id'
--     )
--   ORDER BY column_name;
--   -- Expect all 10 (9 new + confirm none pre-existing were duplicated).
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'leads_imported_via_import_id_fkey';
--   -- Expect one row IF lead_imports existed at migration time; zero rows
--   -- (with a NOTICE explaining why in the migration output) otherwise —
--   -- either outcome is a valid, non-error result.
--
-- Also confirm nothing else changed:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND conname IN ('leads_source_check');
--   -- Must be byte-for-byte identical to its pre-migration definition.
-- ─────────────────────────────────────────────────────────────────────────────
