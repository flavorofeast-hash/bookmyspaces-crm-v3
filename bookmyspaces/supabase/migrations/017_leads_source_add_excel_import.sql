-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 017: Extend leads.source CHECK constraint
-- File  : 017_leads_source_add_excel_import.sql
-- Runs  : AFTER 001_initial_schema.sql (extends the original constraint
--         directly — see REVISION note below)
--
-- REVISION (architecture decision, this session — superseding migration 016):
-- leads.source is acquisition-channel data, consumed as such by real,
-- live code: src/lib/lead-scorer.ts's sourceScores map, and three separate
-- acquisition/revenue-attribution views (src/app/api/dashboard/revenue/
-- route.ts's bySource, src/lib/campaigns.ts's bySource /
-- "Customer acquisition trend", src/lib/analytics/revenue-intelligence.ts's
-- revenueByLeadSource). Migration 016 added 'proposal' — a workflow label,
-- not a channel — to this column, which would have polluted all three of
-- those reports. Investigated and confirmed: nothing in migrations
-- 017-026 or in current application code has a functional dependency on
-- 'proposal' being a valid value (proposal-service.ts was the only writer,
-- and proposals.lead_id already correctly models "this lead has a
-- proposal" without needing a source label). Migration 016 is therefore
-- retired, unapplied, not part of the active migration sequence.
-- proposal-service.ts now writes source: 'other' instead.
--
-- This migration (017) is rewritten to extend the ORIGINAL
-- 001_initial_schema.sql 6-value list directly, independent of 016.
-- Confirmed safe to rewrite: 016 and 017 have never been applied to
-- production — the customer-proposal-sync bug that originally motivated
-- 016 (proposals created with lead_id NULL for brand-new customers) was
-- independently reproduced and confirmed live in production QA this same
-- session, which is only possible if leads_source_check still has its
-- original 6 values. 017's own PRE-FLIGHT check (below) would additionally
-- have refused to proceed against a 6-value constraint, since it expected
-- 7. No live row can therefore depend on either migration's schema state.
--
-- PURPOSE (Lead Import hardening — unchanged from the original 017):
-- src/app/api/leads/import/route.ts inserts new `leads` rows with
-- source = 'excel_import' as the default (via resolveSource(), when the
-- uploaded file has no Source column or an unrecognized value).
-- leads.source's CHECK constraint (001_initial_schema.sql) only allows
-- ('website', 'whatsapp', 'instagram', 'justdial', 'referral', 'other');
-- 'excel_import' is not among them. Every Lead Import insert has therefore
-- been throwing a Postgres check_violation (23514) for every row of every
-- file, 100% of the time. The insert error was only console.log'd
-- (route.ts, never surfaced), so the API still returned success:true and
-- the UI showed "Import Complete" with 0 leads actually written.
--
-- SCOPE — deliberately narrow, per project convention:
--   - Adds exactly one value to the ORIGINAL list: 'excel_import'.
--   - Does NOT add 'proposal' (see REVISION above).
--   - Does NOT remove or rename any of the 6 original acquisition-channel
--     values (website, whatsapp, instagram, justdial, referral, other).
--   - Does NOT relax the constraint to accept arbitrary values.
--   - Does NOT touch leads.status or any other column/constraint. (The
--     Lead Import status bug — hardcoded status:'new', not a valid
--     leads_status_check value — is fixed separately in application code
--     by mapping to the existing 'new_inquiry' value; no schema change
--     needed for that half.)
--   - No application code is changed by this migration file itself.
--
-- SAFETY:
--   - Purely additive to the allowed-value list — cannot reject any row
--     that was previously valid; can only newly ACCEPT rows with
--     source = 'excel_import' that were previously rejected.
--   - No existing data is read, modified, or migrated.
--   - Idempotent: safe to re-run (DROP CONSTRAINT IF EXISTS / recreate).
--   - Same drop-and-recreate pattern used in 010 (proposals.status).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT — run this SELECT FIRST, before the ALTER below, and confirm
-- the result matches what's expected. Do not proceed blind.
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND contype = 'c' AND conname ILIKE '%source%';
--
-- Expected: one row, conname = leads_source_check, definition equivalent to
--   CHECK (source = ANY (ARRAY['website','whatsapp','instagram','justdial','referral','other']))
-- (the original 6 values — 016 was never applied, so 'proposal' should NOT
-- be present). If the constraint name or value list is different from
-- this — in particular, if 'proposal' IS already present — STOP and report
-- back before running the ALTER. That would mean 016 was applied after
-- all, contradicting the evidence above, and needs to be understood before
-- proceeding.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- SECTION 1: EXTEND leads.source CHECK CONSTRAINT
-- Existing constraint (001_initial_schema.sql:44-45) allows:
--   website | whatsapp | instagram | justdial | referral | other
-- We add: excel_import

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
    'excel_import'
  ));

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND conname = 'leads_source_check';
--
-- Expect all 7 values present (the original 6 plus 'excel_import'), and
-- 'proposal' NOT present.
--
-- Then confirm the app-code half of the fix actually works end-to-end:
--   1. Upload a small test file (2-3 rows) via /dashboard/leads/import.
--   2. Confirm summary.inserted > 0 (not silently 0).
--   3. SELECT id, name, phone, source, status FROM leads WHERE source =
--      'excel_import' ORDER BY created_at DESC LIMIT 5; — confirm rows
--      exist with status = 'new_inquiry'.
-- ─────────────────────────────────────────────────────────────────────────────
