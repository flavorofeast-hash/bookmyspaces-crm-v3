-- ─────────────────────────────────────────────────────────────────────────────
-- FILE: scripts/verify-migrations-026-027.sql
-- Read-only live-schema verification for migrations 026 and 027, written
-- 2026-08-01 (RC2 Phase 2, Production Database Verification) per
-- PRODUCTION_VERIFICATION_REPORT.md §1. These are the two newest migrations
-- in the repository — neither appears in MASTER_DATABASE.md's migration
-- inventory table (which stops at 025), and no prior audit document in this
-- repo has ever checked their live status. Same guarantees and format as
-- scripts/verify-migration-023.sql / verify-migrations-012-013-016-017-024.sql:
--
-- GUARANTEES:
--   - Every statement below is a SELECT. No INSERT, UPDATE, DELETE, CREATE,
--     ALTER, DROP, TRUNCATE, or GRANT anywhere in this file.
--   - Every check reads only Postgres/Supabase system catalogs
--     (information_schema.*, pg_catalog.*) — never your actual application
--     data (no `leads`/`follow_ups` rows are ever read).
--   - Safe to run against production at any time, any number of times.
--
-- WHY 027 IS THE HIGHEST-PRIORITY CHECK IN THIS FILE:
-- src/lib/visits/site-visit-service.ts's scheduleSiteVisit() INSERTs
-- property/purpose/guest_count/budget into `follow_ups` by name on every
-- single site-visit request — an AI chat conversation confirming a visit,
-- or a staff member submitting /visits/new. Unlike a `SELECT *` (which
-- silently omits missing columns), a named-column INSERT against a column
-- that doesn't exist throws a hard Postgres error. If 027 is not live, the
-- entire Site Visit Scheduling feature (Sprint 1) — and everything chained
-- after it (Sprint 2's Visit -> Proposal Draft pipeline, Sprint 3A's
-- Founder Dashboard timeline) — fails on every attempt, not just degrades.
--
-- HOW TO USE: paste this whole file into the Supabase SQL Editor and run
-- it. One result set: a TL;DR line per migration, PASS/FAIL summary rows,
-- then full per-object detail underneath.
-- ─────────────────────────────────────────────────────────────────────────────

WITH checks(migration, area, object_name, passed) AS (
  VALUES

  -- Migration 027 — follow_ups site-visit columns (see header note: highest priority)
  ('027', 'column', 'follow_ups.property',    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='follow_ups' AND column_name='property')),
  ('027', 'column', 'follow_ups.purpose',     EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='follow_ups' AND column_name='purpose')),
  ('027', 'column', 'follow_ups.guest_count', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='follow_ups' AND column_name='guest_count')),
  ('027', 'column', 'follow_ups.budget',      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='follow_ups' AND column_name='budget')),
  ('027', 'index',  'idx_follow_ups_type_scheduled_at', EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_follow_ups_type_scheduled_at')),

  -- Migration 026 — leads campaign-attribution columns
  ('026', 'column', 'leads.campaign',     EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='campaign')),
  ('026', 'column', 'leads.landing_page', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='landing_page')),
  ('026', 'column', 'leads.utm_source',   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='utm_source')),
  ('026', 'column', 'leads.utm_medium',   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='utm_medium')),
  ('026', 'column', 'leads.utm_campaign', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='utm_campaign')),
  ('026', 'column', 'leads.referral',     EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='referral'))

),

rollup AS (
  SELECT
    migration,
    count(*)                       AS checks_run,
    count(*) FILTER (WHERE passed) AS checks_passed,
    bool_and(passed)               AS all_passed,
    string_agg(object_name, ', ' ORDER BY object_name) FILTER (WHERE NOT passed) AS missing_objects
  FROM checks
  GROUP BY migration
),

tldr AS (
  SELECT
    migration,
    CASE
      WHEN all_passed THEN 'Migration ' || migration || ' IS fully applied to production.'
      ELSE 'Migration ' || migration || ' is NOT fully applied. Missing: ' || missing_objects || '.'
    END AS line
  FROM rollup
)

SELECT 'TL;DR' AS section, migration AS area, '' AS object_name, line AS result, 0 AS sort_key
FROM tldr

UNION ALL

SELECT
  '1_SUMMARY' AS section,
  'Migration ' || r.migration AS area,
  r.checks_passed || ' / ' || r.checks_run || ' objects found' AS object_name,
  CASE WHEN r.all_passed THEN 'PASS — fully applied' ELSE 'FAIL — NOT fully applied' END AS result,
  1 AS sort_key
FROM rollup r

UNION ALL

SELECT
  '2_DETAIL' AS section,
  'Migration ' || c.migration AS area,
  c.object_name,
  CASE WHEN c.passed THEN 'PASS' ELSE 'FAIL' END AS result,
  2 AS sort_key
FROM checks c

ORDER BY sort_key, area, object_name;
