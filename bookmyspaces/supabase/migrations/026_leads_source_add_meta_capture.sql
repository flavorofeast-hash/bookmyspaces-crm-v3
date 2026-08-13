-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 026: Extend leads.source CHECK constraint for
-- Meta Lead Ads / Messenger / Instagram DM capture
-- File  : 026_leads_source_add_meta_capture.sql
-- Runs  : AFTER 017_leads_source_add_excel_import.sql (extends the same
--         constraint again, now allowing 11 values instead of 7)
--
-- PURPOSE:
-- src/lib/leads/create-lead-with-journey.ts's captureLeadWithJourney() is
-- the single lead-creation path used by the Direct Event Sales Engine's
-- social capture (src/app/api/social/webhook/[platform]/route.ts,
-- src/lib/social/meta-lead-capture.ts, src/lib/social/dm-capture-service.ts)
-- for four sources — 'facebook_lead_ads', 'instagram_lead_ads',
-- 'facebook_messenger', 'instagram_dm' — passed straight through to
-- leads.source on insert (create-lead-with-journey.ts:87). NONE of these
-- four values are in leads_source_check as it stands after migration 017
-- ('website','whatsapp','instagram','justdial','referral','other',
-- 'excel_import'). Every Lead Ads / Messenger / IG-DM lead capture has
-- therefore been failing the insert with a Postgres check_violation
-- (23514) 100% of the time.
--
-- This is the exact same bug class as migration 017 (excel_import) and
-- migration 024 (ai_interaction_log.interaction_type) before it: the
-- insert error is caught and logged, never surfaced
-- (create-lead-with-journey.ts:94-97's fault-tolerant try/catch, by
-- design — a lead-capture failure must not take down a webhook), so the
-- Meta webhook still returns 200 with leadsFromForms/leadsFromMessages
-- silently 0 for every event, indistinguishable from "nothing came in"
-- without reading server logs.
--
-- SCOPE — deliberately narrow, per project convention (016/017):
--   - Adds exactly four values: 'facebook_lead_ads', 'instagram_lead_ads',
--     'facebook_messenger', 'instagram_dm'.
--   - Does NOT remove or rename any existing allowed value (website,
--     whatsapp, instagram, justdial, referral, other, excel_import all
--     remain).
--   - Does NOT relax the constraint to accept arbitrary values.
--   - Does NOT touch any other column or constraint.
--
-- SAFETY:
--   - Purely permissive: only allows 4 new values for future inserts.
--   - No existing data is read, modified, or migrated.
--   - Idempotent: safe to re-run (DROP CONSTRAINT IF EXISTS / recreate),
--     same pattern as 010/016/017.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT — run manually before this migration to confirm the current
-- constraint is exactly the 017 state this migration expects to extend:
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND contype = 'c' AND conname ILIKE '%source%';
--
-- Expected: one row, conname = leads_source_check, definition equivalent to
--   CHECK (source = ANY (ARRAY['website','whatsapp','instagram','justdial','referral','other','excel_import']))
-- (7 values.) If the constraint name or value list is different from this,
-- STOP and report back before running the ALTER — do not assume.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- SECTION 1: EXTEND leads.source CHECK CONSTRAINT
-- Existing constraint (017, current) allows:
--   website | whatsapp | instagram | justdial | referral | other | excel_import
-- We add: facebook_lead_ads, instagram_lead_ads, facebook_messenger, instagram_dm

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
    'excel_import',
    'facebook_lead_ads',
    'instagram_lead_ads',
    'facebook_messenger',
    'instagram_dm'
  ));

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND conname = 'leads_source_check';
--
-- Expect all 11 values present, including the 4 new Meta capture sources.
--
-- Then confirm the app-code half actually works end-to-end: trigger a test
-- Lead Ads submission or Messenger message against the connected Page (once
-- Meta credentials exist — see META_SETUP.md) and confirm a `leads` row is
-- created with the corresponding source value, not silently dropped.
-- ─────────────────────────────────────────────────────────────────────────────
