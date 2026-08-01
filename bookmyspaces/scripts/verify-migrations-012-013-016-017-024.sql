-- ─────────────────────────────────────────────────────────────────────────────
-- FILE: scripts/verify-migrations-012-013-016-017-024.sql
-- Read-only live-schema verification for migrations 012, 013, 016, 017, 024.
-- Written 2026-07-29 (RC1 mode), per audit/PRODUCTION_MIGRATION_STATE_VERIFICATION.md.
--
-- GUARANTEES:
--   - Every statement below is a SELECT. There is no INSERT, UPDATE, DELETE,
--     CREATE, ALTER, DROP, TRUNCATE, or GRANT anywhere in this file.
--   - Every check reads only Postgres/Supabase system catalogs
--     (information_schema.*, pg_catalog.*) — never a query against your
--     actual application data (leads, reservations, proposals, etc. rows
--     are never read).
--   - Safe to run against production at any time, any number of times.
--
-- HOW TO USE:
--   Paste this whole file into the Supabase SQL Editor and run it. It is a
--   single query, producing ONE result set (deliberately — some SQL clients
--   only display the last statement's result, so everything needed lives
--   in one query rather than risking a hidden second result set):
--
--     Row 1        : "TL;DR" — one line naming exactly which migrations
--                    (if any) still need to be applied.
--     Rows 2-6     : one row per migration (012/013/016/017/024) with its
--                    own PASS/FAIL, how many objects were found vs.
--                    expected, and which specific object(s) are missing.
--     Remaining rows: full per-object detail (one row per table/column/
--                    constraint/index/trigger/RLS-flag checked), so you can
--                    see exactly what was tested behind every PASS/FAIL above.
--
--   Sort/filter the result grid by the `section` column (SUMMARY vs DETAIL)
--   if you want to look at just one part.
--
-- WHAT "PASS" MEANS: every table/column/constraint-value/index/trigger/RLS
-- flag that migration is supposed to create or change was found present.
-- WHAT "FAIL" MEANS: at least one of those objects is missing — the
-- migration (or part of it) has not been applied. The DETAIL rows name
-- exactly which object(s) failed.
-- ─────────────────────────────────────────────────────────────────────────────

WITH checks(migration, area, object_name, passed) AS (
  VALUES

  -- ═══════════════════════════════════════════════════════════════════════
  -- MIGRATION 012 — V3 Foundation Schema (16 tables + key indexes/triggers/RLS)
  -- ═══════════════════════════════════════════════════════════════════════

  -- All 16 tables this migration creates
  ('012', 'table', 'properties',                 EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='properties')),
  ('012', 'table', 'customer_identities',         EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_identities')),
  ('012', 'table', 'channels',                    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='channels')),
  ('012', 'table', 'unified_conversations',       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='unified_conversations')),
  ('012', 'table', 'unified_conversation_channels', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='unified_conversation_channels')),
  ('012', 'table', 'unified_messages',            EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='unified_messages')),
  ('012', 'table', 'inventory_items',             EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='inventory_items')),
  ('012', 'table', 'meal_plans',                  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='meal_plans')),
  ('012', 'table', 'rate_plans',                  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='rate_plans')),
  ('012', 'table', 'addon_services',              EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='addon_services')),
  ('012', 'table', 'reservations',                EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reservations')),
  ('012', 'table', 'reservation_addons',          EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='reservation_addons')),
  ('012', 'table', 'settings',                    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='settings')),
  ('012', 'table', 'ai_prompts',                  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_prompts')),
  ('012', 'table', 'knowledge_sources',           EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='knowledge_sources')),
  ('012', 'table', 'ai_interaction_log',          EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ai_interaction_log')),

  -- reservations: the columns Sprint 1's availability-service.ts/reservation-service.ts depend on directly
  ('012', 'column', 'reservations.inventory_item_id', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='inventory_item_id')),
  ('012', 'column', 'reservations.check_in_date',     EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='check_in_date')),
  ('012', 'column', 'reservations.check_out_date',    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='check_out_date')),
  ('012', 'column', 'reservations.status',            EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='status')),
  ('012', 'column', 'reservations.nights (generated)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='nights')),

  -- reservations: indexes checkAvailability()'s overlap query relies on
  ('012', 'index', 'idx_reservations_dates',            EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_reservations_dates')),
  ('012', 'index', 'idx_reservations_status',           EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_reservations_status')),
  ('012', 'index', 'idx_reservations_inventory_item_id', EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_reservations_inventory_item_id')),

  -- reservations: updated_at trigger + RLS
  ('012', 'trigger', 'update_reservations_updated_at', EXISTS(SELECT 1 FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table='reservations' AND trigger_name='update_reservations_updated_at')),
  ('012', 'rls',     'reservations RLS enabled',       EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='reservations' AND c.relrowsecurity)),

  -- knowledge_sources: the vector index caught and fixed before this migration was ever applied
  ('012', 'index', 'idx_knowledge_sources_embedding', EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_knowledge_sources_embedding')),

  -- ai_interaction_log: the Sprint 4 columns added directly into this migration (lead_id/interaction_type/summary — not present in an earlier draft)
  ('012', 'column', 'ai_interaction_log.lead_id',         EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_interaction_log' AND column_name='lead_id')),
  ('012', 'column', 'ai_interaction_log.interaction_type', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_interaction_log' AND column_name='interaction_type')),
  ('012', 'column', 'ai_interaction_log.summary',          EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_interaction_log' AND column_name='summary')),

  -- ═══════════════════════════════════════════════════════════════════════
  -- MIGRATION 013 — Proposal <-> Reservation Platform links (alters `proposals`)
  -- ═══════════════════════════════════════════════════════════════════════

  ('013', 'column', 'proposals.property_id',        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='property_id')),
  ('013', 'column', 'proposals.inventory_item_id',   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='inventory_item_id')),
  ('013', 'column', 'proposals.reservation_id',      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='reservation_id')),
  ('013', 'column', 'proposals.package_id',          EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='package_id')),
  ('013', 'column', 'proposals.addon_service_ids',   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='addon_service_ids')),
  ('013', 'index',  'idx_proposals_property_id',     EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_proposals_property_id')),
  ('013', 'index',  'idx_proposals_reservation_id',  EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_proposals_reservation_id')),

  -- ═══════════════════════════════════════════════════════════════════════
  -- MIGRATION 016 — leads.source CHECK constraint gains 'proposal'
  -- ═══════════════════════════════════════════════════════════════════════

  ('016', 'constraint', 'leads_source_check allows ''proposal''',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_check' AND pg_get_constraintdef(oid) LIKE '%proposal%')),

  -- ═══════════════════════════════════════════════════════════════════════
  -- MIGRATION 017 — leads.source CHECK constraint gains 'excel_import'
  -- ═══════════════════════════════════════════════════════════════════════

  ('017', 'constraint', 'leads_source_check allows ''excel_import''',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'leads_source_check' AND pg_get_constraintdef(oid) LIKE '%excel_import%')),

  -- ═══════════════════════════════════════════════════════════════════════
  -- MIGRATION 024 — Direct Event Sales Engine expansion (packages/proposals columns + ai_interaction_log CHECK)
  -- ═══════════════════════════════════════════════════════════════════════

  ('024', 'column', 'packages.hall',                   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='hall')),
  ('024', 'column', 'packages.seating_style',           EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='seating_style')),
  ('024', 'column', 'packages.addon_service_ids',       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='addon_service_ids')),
  ('024', 'column', 'packages.seasonal_pricing',        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='seasonal_pricing')),
  ('024', 'column', 'packages.standard_discount_pct',   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='standard_discount_pct')),
  ('024', 'index',  'idx_packages_hall',                EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_packages_hall')),
  ('024', 'column', 'proposals.hall',                   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='hall')),
  ('024', 'index',  'idx_proposals_hall',                EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_proposals_hall')),
  ('024', 'constraint', 'ai_interaction_log_interaction_type_check allows ''upsell_recommendations''',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'ai_interaction_log_interaction_type_check' AND pg_get_constraintdef(oid) LIKE '%upsell_recommendations%')),
  ('024', 'constraint', 'ai_interaction_log_interaction_type_check allows ''event_sales_advisor''',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'ai_interaction_log_interaction_type_check' AND pg_get_constraintdef(oid) LIKE '%event_sales_advisor%'))

),

-- ── Per-migration rollup: PASS only if every one of its checks passed ───
rollup AS (
  SELECT
    migration,
    count(*)                                   AS checks_run,
    count(*) FILTER (WHERE passed)             AS checks_passed,
    bool_and(passed)                           AS all_passed,
    string_agg(object_name, ', ' ORDER BY object_name) FILTER (WHERE NOT passed) AS missing_objects
  FROM checks
  GROUP BY migration
),

-- ── One combined "still need to apply" line across all 5 migrations ─────
tldr AS (
  SELECT
    CASE
      WHEN bool_and(all_passed) THEN 'All 5 migrations (012, 013, 016, 017, 024) are fully applied. No action needed.'
      ELSE 'Still need to apply: ' || string_agg(migration, ', ' ORDER BY migration) FILTER (WHERE NOT all_passed) || '.'
    END AS line
  FROM rollup
)

-- ── Unified, single result set: TL;DR row, then one summary row per ─────
--    migration, then full per-object detail. `section` groups/sorts them. ──
SELECT 'TL;DR' AS section, '' AS migration, '' AS status_or_area, '' AS found_or_object, tldr.line AS detail_or_note, 0 AS sort_key
FROM tldr

UNION ALL

SELECT
  '1_SUMMARY' AS section,
  'Migration ' || r.migration AS migration,
  CASE WHEN r.all_passed THEN 'PASS — fully applied' ELSE 'FAIL — NOT fully applied' END AS status_or_area,
  r.checks_passed || ' / ' || r.checks_run || ' objects found' AS found_or_object,
  CASE
    WHEN r.all_passed THEN 'No action needed.'
    ELSE 'Missing: ' || r.missing_objects || '. Apply supabase/migrations/' || r.migration || '_*.sql.'
  END AS detail_or_note,
  1 AS sort_key
FROM rollup r

UNION ALL

SELECT
  '2_DETAIL' AS section,
  'Migration ' || c.migration AS migration,
  c.area AS status_or_area,
  c.object_name AS found_or_object,
  CASE WHEN c.passed THEN 'PASS' ELSE 'FAIL' END AS detail_or_note,
  2 AS sort_key
FROM checks c

ORDER BY sort_key, migration, status_or_area, found_or_object;
