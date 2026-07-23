-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 017: Extend leads.source CHECK constraint
-- File  : 017_leads_source_add_excel_import.sql
-- Runs  : AFTER 016_leads_source_add_proposal.sql (extends the same constraint
--         again, now allowing 8 values instead of 7)
--
-- PURPOSE (Lead Import hardening):
-- src/app/api/leads/import/route.ts inserts new `leads` rows with
-- source = 'excel_import' (route.ts:112, default when the uploaded file has
-- no Source column or an unrecognized value). leads.source's CHECK
-- constraint — even after migration 016 — only allows ('website', 'whatsapp',
-- 'instagram', 'justdial', 'referral', 'other', 'proposal'); 'excel_import'
-- is not among them. Every Lead Import insert has therefore been throwing a
-- Postgres check_violation (23514) for every row of every file, 100% of the
-- time. The insert error was only console.log'd (route.ts, never surfaced),
-- so the API still returned success:true and the UI showed "Import
-- Complete" with 0 leads actually written. This migration is the schema
-- half of the fix; the app-code half (status mapping + source whitelist
-- validation + error surfacing) ships alongside it in the same change.
--
-- This gap was already flagged as a known follow-up in migration 016's own
-- header comment ("Does NOT address the separate, already-identified Lead
-- Import issues... confirmed broken independently of this fix") — this
-- migration closes that follow-up.
--
-- SCOPE — deliberately narrow, per project convention:
--   - Adds exactly one value: 'excel_import'.
--   - Does NOT remove or rename any existing allowed value (website,
--     whatsapp, instagram, justdial, referral, other, proposal all remain).
--   - Does NOT relax the constraint to accept arbitrary values.
--   - Does NOT touch leads.status or any other column/constraint. (The
--     Lead Import status bug — hardcoded status:'new', which is not a
--     valid value in leads_status_check either — is fixed separately in
--     application code by mapping to the existing 'new_inquiry' value; no
--     schema change is needed for that half of the fix.)
--   - No application code is changed by this migration file itself.
--
-- SAFETY:
--   - Purely additive to the allowed-value list — cannot reject any row
--     that was previously valid; can only newly ACCEPT rows with
--     source = 'excel_import' that were previously rejected.
--   - No existing data is read, modified, or migrated.
--   - Idempotent: safe to re-run (DROP CONSTRAINT IF EXISTS / recreate).
--   - Same drop-and-recreate pattern used in 010 (proposals.status) and
--     016 (leads.source itself, one value earlier).
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
--   CHECK (source = ANY (ARRAY['website','whatsapp','instagram','justdial','referral','other','proposal']))
-- (7 values, matching migration 016's post-flight expectation.) If the
-- constraint name or value list is different from this, STOP and report
-- back before running the ALTER — do not assume 016 applied cleanly.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- SECTION 1: EXTEND leads.source CHECK CONSTRAINT
-- Existing constraint (after 016) allows:
--   website | whatsapp | instagram | justdial | referral | other | proposal
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
    'proposal',
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
-- Expect all 8 values present, including 'excel_import'.
--
-- Then confirm the app-code half of the fix actually works end-to-end:
--   1. Upload a small test file (2-3 rows) via /dashboard/leads/import.
--   2. Confirm summary.inserted > 0 (not silently 0).
--   3. SELECT id, name, phone, source, status FROM leads WHERE source =
--      'excel_import' ORDER BY created_at DESC LIMIT 5; — confirm rows
--      exist with status = 'new_inquiry'.
-- ─────────────────────────────────────────────────────────────────────────────
