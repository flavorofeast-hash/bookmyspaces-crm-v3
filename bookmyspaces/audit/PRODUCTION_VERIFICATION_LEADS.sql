-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — PRODUCTION VERIFICATION SCRIPT: leads table
-- Purpose: read-only inspection of the live `leads` table before touching
-- migration 017 or designing the Customer Bulk Import feature.
--
-- SAFETY: 100% read-only. No ALTER / INSERT / UPDATE / DELETE / DROP
-- statements anywhere in this file. Every statement is a SELECT against
-- system catalogs (pg_catalog / information_schema) or a SELECT ... GROUP BY
-- against `leads` itself. Safe to run as-is in the Supabase SQL Editor.
--
-- Run each section, copy the full output back (including empty results —
-- an empty result for, say, section D means "no triggers", which is itself
-- useful information, not something to omit).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- A. TABLE DEFINITION — columns, types, defaults, nullability
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  ordinal_position,
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'leads'
ORDER BY ordinal_position;


-- ─────────────────────────────────────────────────────────────────────────────
-- B. CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

-- B1. Every constraint on leads: CHECK ('c'), PRIMARY KEY ('p'),
--     FOREIGN KEY ('f'), UNIQUE ('u') — one query covers all four types.
SELECT
  con.conname                    AS constraint_name,
  CASE con.contype
    WHEN 'c' THEN 'CHECK'
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    ELSE con.contype::text
  END                             AS constraint_type,
  pg_get_constraintdef(con.oid)  AS definition
FROM pg_constraint con
JOIN pg_class rel      ON rel.oid = con.conrelid
JOIN pg_namespace nsp  ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public' AND rel.relname = 'leads'
ORDER BY constraint_type, constraint_name;

-- B2. Foreign keys in OTHER tables that reference leads(id) — shows what
--     depends on leads, relevant for any future schema change.
SELECT
  con.conname                    AS constraint_name,
  rel.relname                    AS referencing_table,
  pg_get_constraintdef(con.oid)  AS definition
FROM pg_constraint con
JOIN pg_class rel  ON rel.oid = con.conrelid
JOIN pg_class frel ON frel.oid = con.confrelid
WHERE con.contype = 'f' AND frel.relname = 'leads'
ORDER BY referencing_table;


-- ─────────────────────────────────────────────────────────────────────────────
-- C. INDEXES — including explicit phone/email UNIQUE confirmation
-- ─────────────────────────────────────────────────────────────────────────────

-- C1. Every index on leads, full definition.
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'leads'
ORDER BY indexname;

-- C2. Direct answer to "is phone/email unique?" — independent of C1, cross-
--     checks column-level uniqueness via pg_index rather than parsing DDL text.
SELECT
  a.attname       AS column_name,
  i.relname       AS index_name,
  ix.indisunique  AS is_unique,
  ix.indisprimary AS is_primary
FROM pg_index ix
JOIN pg_class i     ON i.oid = ix.indexrelid
JOIN pg_class t     ON t.oid = ix.indrelid
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
WHERE t.relname = 'leads' AND a.attname IN ('phone', 'email')
ORDER BY column_name;


-- ─────────────────────────────────────────────────────────────────────────────
-- D. TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  tg.tgname               AS trigger_name,
  pg_get_triggerdef(tg.oid) AS definition,
  tg.tgenabled             AS enabled_status   -- 'O' = enabled (origin), 'D' = disabled
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
WHERE c.relname = 'leads' AND NOT tg.tgisinternal
ORDER BY trigger_name;


-- ─────────────────────────────────────────────────────────────────────────────
-- E. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

-- E1. Is RLS enabled / force-enabled on leads?
SELECT
  relname,
  relrowsecurity   AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'leads' AND relnamespace = 'public'::regnamespace;

-- E2. Every policy on leads, with the command it applies to and its
--     USING / WITH CHECK expressions — this is what determines whether
--     INSERT/UPDATE/SELECT actually succeed for a given role.
SELECT
  pol.polname AS policy_name,
  CASE pol.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS applies_to,
  pol.polroles::regrole[]              AS roles,
  pg_get_expr(pol.polqual, pol.polrelid)     AS using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
FROM pg_policy pol
WHERE pol.polrelid = 'leads'::regclass
ORDER BY applies_to, policy_name;


-- ─────────────────────────────────────────────────────────────────────────────
-- F. LIVE DATA VALIDATION — actual values in use today
-- ─────────────────────────────────────────────────────────────────────────────

-- F1. Distinct source values + row counts (must all satisfy whatever the
--     live leads_source_check constraint currently is — a value appearing
--     here that ISN'T in the migration-016 list would itself be proof of
--     drift).
SELECT source, COUNT(*) AS row_count
FROM leads
GROUP BY source
ORDER BY row_count DESC;

-- F2. Distinct status values + row counts (same logic, against
--     leads_status_check).
SELECT status, COUNT(*) AS row_count
FROM leads
GROUP BY status
ORDER BY row_count DESC;

-- F3. Total row count, for scale/context on the counts above.
SELECT COUNT(*) AS total_leads FROM leads;


-- ─────────────────────────────────────────────────────────────────────────────
-- G. DATA QUALITY — duplicate identifiers
-- ─────────────────────────────────────────────────────────────────────────────

-- G1. Duplicate phone numbers (NULLs excluded — NULL never equals NULL, so
--     grouping on phone alone won't falsely flag missing values as dupes).
SELECT phone, COUNT(*) AS occurrences
FROM leads
WHERE phone IS NOT NULL
GROUP BY phone
HAVING COUNT(*) > 1
ORDER BY occurrences DESC;

-- G2. Duplicate email addresses (case-insensitive — 'a@x.com' and
--     'A@X.com' should count as the same duplicate).
SELECT LOWER(email) AS email_lower, COUNT(*) AS occurrences
FROM leads
WHERE email IS NOT NULL AND email <> ''
GROUP BY LOWER(email)
HAVING COUNT(*) > 1
ORDER BY occurrences DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- H. LIFECYCLE_STAGE — self-guarding, never errors, never blocks the rest of
--    the script. Checks column existence first; only queries the column if
--    it's actually there. Output appears in the Supabase SQL Editor's
--    "Notices"/messages panel (RAISE NOTICE), not as a result grid — that's
--    a deliberate tradeoff to guarantee this section can never fail the
--    statements after it, the way the unguarded version just did.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  col_exists boolean;
  rec RECORD;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'lifecycle_stage'
  ) INTO col_exists;

  IF NOT col_exists THEN
    RAISE NOTICE 'lifecycle_stage: column does not exist in production (expected — Architecture v1.0 has not introduced it yet). Section H skipped.';
  ELSE
    RAISE NOTICE 'lifecycle_stage: column exists. Distinct values:';
    FOR rec IN EXECUTE 'SELECT lifecycle_stage, COUNT(*) AS row_count FROM leads GROUP BY lifecycle_stage ORDER BY row_count DESC'
    LOOP
      RAISE NOTICE '  % => %', rec.lifecycle_stage, rec.row_count;
    END LOOP;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- I. RELATED / UNDOCUMENTED OBJECTS — anything else touching leads that
--    isn't already covered by sections B-E
-- ─────────────────────────────────────────────────────────────────────────────

-- I1. Views that read from leads (precise dependency list, not a text guess).
SELECT view_name, table_schema
FROM information_schema.view_table_usage
WHERE table_name = 'leads' AND table_schema = 'public'
ORDER BY view_name;

-- I2. Functions whose body references `leads` — catches trigger functions,
--     RPCs, or anything else with undocumented coupling to this table.
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%leads%'
ORDER BY function_name;


-- ─────────────────────────────────────────────────────────────────────────────
-- J. LEAD IMPORT — TARGETED CHECK (isolates exactly what the import route
--    depends on, pulled out from Section B for quick visual confirmation)
-- ─────────────────────────────────────────────────────────────────────────────

-- J1. Just the source/status CHECK constraints, isolated.
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'leads' AND con.contype = 'c'
  AND (con.conname ILIKE '%source%' OR con.conname ILIKE '%status%')
ORDER BY con.conname;

-- J2. Nullability/defaults for exactly the columns the import route writes:
--     name, phone, email, source, notes, status.
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'leads'
  AND column_name IN ('name', 'phone', 'email', 'source', 'notes', 'status')
ORDER BY column_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF SCRIPT. Paste the full output of every section (A through J) back —
-- including empty results, and including whether Section H ran at all.
-- Comparison against 001_initial_schema.sql, migration 016, and the current
-- repository schema happens after this, not before.
-- ═══════════════════════════════════════════════════════════════════════════
