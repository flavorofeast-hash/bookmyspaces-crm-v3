-- ─────────────────────────────────────────────────────────────────────────────
-- FILE: scripts/verify-migration-023.sql
-- Read-only live-schema verification for migration 023
-- (023_event_package_management.sql). Written 2026-07-29 (RC1 mode), per
-- audit/MIGRATION_023_DEPLOYMENT_REVIEW.md.
--
-- GUARANTEES:
--   - Every statement below is a SELECT. No INSERT, UPDATE, DELETE, CREATE,
--     ALTER, DROP, TRUNCATE, or GRANT anywhere in this file.
--   - Every check reads only Postgres/Supabase system catalogs
--     (information_schema.*, pg_catalog.*) — never your actual application
--     data (no `packages`/`proposals` rows are ever read).
--   - Safe to run against production at any time, any number of times.
--
-- IMPORTANT NOTE ON `proposals.package_id` / `idx_proposals_package_id`:
-- both are ALSO added by migration 013 (already confirmed live), using the
-- exact same `IF NOT EXISTS` column/index names. If 013 ran first (it has),
-- these two objects existing is NOT reliable evidence that 023 specifically
-- has run — 023's own `ADD COLUMN IF NOT EXISTS package_id` would just be a
-- safe no-op either way. They're included below for completeness and
-- labelled accordingly; treat the `packages.*` checks as the authoritative
-- signal for 023's status, since nothing else in this codebase touches
-- those five columns.
--
-- HOW TO USE: paste this whole file into the Supabase SQL Editor and run
-- it. One result set: a TL;DR line, then a single PASS/FAIL summary row for
-- migration 023, then full per-object detail underneath.
-- ─────────────────────────────────────────────────────────────────────────────

WITH checks(migration, area, object_name, passed) AS (
  VALUES

  -- packages: the five columns only 023 adds — the authoritative signal
  ('023', 'column', 'packages.event_types',              EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='event_types')),
  ('023', 'column', 'packages.images',                    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='images')),
  ('023', 'column', 'packages.room_inventory_item_ids',   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='room_inventory_item_ids')),
  ('023', 'column', 'packages.meal_plan_id',               EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='meal_plan_id')),
  ('023', 'column', 'packages.tax_rate_override_pct',     EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='tax_rate_override_pct')),

  -- packages.meal_plan_id: not just column existence -- confirm it's a real FK into meal_plans(id), not just a bare UUID column
  ('023', 'constraint', 'packages.meal_plan_id has a FK to meal_plans',
    EXISTS(
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = 'packages' AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'meal_plan_id' AND ccu.table_name = 'meal_plans'
    )),

  -- idx_packages_event_types: existence, AND that it's genuinely a GIN index (required for the array-containment queries this column exists for)
  ('023', 'index', 'idx_packages_event_types exists',      EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_packages_event_types')),
  ('023', 'index', 'idx_packages_event_types is a GIN index', EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_packages_event_types' AND indexdef ILIKE '%USING gin%')),

  -- proposals.package_id / its index: ALSO added by migration 013 (confirmed live) -- see note above, not authoritative for 023 alone, included for completeness
  ('023', 'column (ambiguous w/ 013)', 'proposals.package_id',      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='package_id')),
  ('023', 'index (ambiguous w/ 013)',  'idx_proposals_package_id',  EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_proposals_package_id'))

),

-- Only the unambiguous `packages.*` checks + the GIN index decide PASS/FAIL
-- for migration 023 itself, per the note above.
authoritative AS (
  SELECT * FROM checks WHERE area NOT LIKE '%ambiguous%'
),

rollup AS (
  SELECT
    count(*)                           AS checks_run,
    count(*) FILTER (WHERE passed)     AS checks_passed,
    bool_and(passed)                   AS all_passed,
    string_agg(object_name, ', ' ORDER BY object_name) FILTER (WHERE NOT passed) AS missing_objects
  FROM authoritative
),

tldr AS (
  SELECT
    CASE
      WHEN all_passed THEN 'Migration 023 IS fully applied to production.'
      ELSE 'Migration 023 is NOT fully applied. Missing: ' || missing_objects || '.'
    END AS line
  FROM rollup
)

SELECT 'TL;DR' AS section, '' AS area, '' AS object_name, tldr.line AS result, 0 AS sort_key
FROM tldr

UNION ALL

SELECT
  '1_SUMMARY' AS section,
  'Migration 023' AS area,
  r.checks_passed || ' / ' || r.checks_run || ' authoritative objects found' AS object_name,
  CASE WHEN r.all_passed THEN 'PASS — fully applied' ELSE 'FAIL — NOT fully applied' END AS result,
  1 AS sort_key
FROM rollup r

UNION ALL

SELECT
  '2_DETAIL' AS section,
  c.area,
  c.object_name,
  CASE WHEN c.passed THEN 'PASS' ELSE 'FAIL' END AS result,
  2 AS sort_key
FROM checks c

ORDER BY sort_key, area, object_name;
