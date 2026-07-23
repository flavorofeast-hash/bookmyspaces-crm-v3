-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 016: Extend leads.source CHECK constraint
-- File  : 016_leads_source_add_proposal.sql
-- Runs  : AFTER 001_initial_schema.sql (extends the same constraint)
--
-- PURPOSE (customer-proposal-sync hotfix):
-- fix/customer-proposal-sync (merged to main, commit 786eab2) added
-- ensureLeadForProposal() (src/lib/proposals/proposal-service.ts:168-206),
-- which inserts a new `leads` row with source = 'proposal' whenever a
-- standalone proposal is created for a brand-new customer with no existing
-- phone/email match. That insert has been silently failing in production:
-- leads.source's CHECK constraint (001_initial_schema.sql:32-45) only
-- allows ('website','whatsapp','instagram','justdial','referral','other') —
-- 'proposal' is not among them. The insert throws a Postgres check_violation
-- (23514); ensureLeadForProposal() fails open (by design — see comment at
-- proposal-service.ts:150-154) and returns null; the proposal is still
-- created, but with lead_id = NULL — invisible on the Customers page
-- (GET /api/leads, which only reads the `leads` table). Full root-cause
-- trace: audit/PROPOSAL_CUSTOMER_SYNC investigation (this session).
--
-- SCOPE — deliberately narrow, per explicit instruction:
--   - Adds exactly one value: 'proposal'.
--   - Does NOT remove or rename any existing allowed value.
--   - Does NOT relax the constraint to accept arbitrary values.
--   - Does NOT touch leads.status or any other column/constraint.
--   - Does NOT address the separate, already-identified Lead Import issues
--     (source='excel_import', status='new', arbitrary CSV-supplied source
--     values in src/app/api/leads/import/route.ts) — confirmed broken
--     independently of this fix, tracked as a separate follow-up.
--   - No application code is changed by this migration.
--
-- SAFETY:
--   - Purely additive to the allowed-value list — cannot reject any row
--     that was previously valid; can only newly ACCEPT rows with
--     source = 'proposal' that were previously rejected.
--   - No existing data is read, modified, or migrated.
--   - Idempotent: safe to re-run (DROP CONSTRAINT IF EXISTS / recreate).
--   - Same drop-and-recreate pattern already used successfully in this
--     codebase for proposals.status
--     (010_phase5_proposal_intelligence.sql:33-47).
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
-- (exact text formatting from Postgres may vary slightly — array literal
-- style, quoting — that's fine; what matters is the 6 values and the name).
-- If the constraint name or value list is different from this, STOP and
-- report back before running the ALTER — do not assume.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- SECTION 1: EXTEND leads.source CHECK CONSTRAINT
-- Existing constraint (001_initial_schema.sql:44-45) allows:
--   website | whatsapp | instagram | justdial | referral | other
-- We add: proposal

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
    'proposal'
  ));

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND conname = 'leads_source_check';
--
-- Expect all 7 values present, including 'proposal'.
-- ─────────────────────────────────────────────────────────────────────────────
