-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 028: Fix leads.source CHECK constraint for Meta
-- capture, correcting for undocumented production drift that broke 026
-- File  : 028_leads_source_check_fix_drift.sql
-- Supersedes: 026_leads_source_add_meta_capture.sql (left unedited in place
--             per project convention — history is not rewritten; this file
--             is the one that actually applies cleanly to production).
--
-- ROOT CAUSE OF 026's FAILURE:
-- 026 was authored assuming leads_source_check was still in the exact state
-- migration 017 left it in (7 values: website, whatsapp, instagram,
-- justdial, referral, other, excel_import), and its pre-flight check said
-- so explicitly. That assumption was wrong. The actual production
-- constraint (confirmed by the caller, not guessed) already allows 13
-- values:
--   excel_import, web, website, whatsapp, whatsapp_website,
--   whatsapp_facebook, whatsapp_instagram, instagram, facebook, justdial,
--   referral, other, proposal
-- Six of these ('web', 'whatsapp_website', 'whatsapp_facebook',
-- 'whatsapp_instagram', 'facebook', 'proposal') trace to no migration file
-- in this repo — undocumented, out-of-band schema drift, the same class of
-- issue already tracked in audit/SCHEMA_DRIFT_REPORT.md for other objects.
--
-- 026's `ADD CONSTRAINT ... CHECK (source IN (11 values))` did not include
-- 'web' or 'facebook'. Live data has rows with source='web' (1) and
-- source='facebook' (1) (confirmed via `SELECT source, COUNT(*) FROM leads
-- GROUP BY source`). Postgres validates a new CHECK constraint against
-- every existing row at ADD time, so the ALTER TABLE ... ADD CONSTRAINT
-- failed immediately with check_violation — exactly the reported error
-- ("check constraint ... is violated by some row"). This was a drift bug in
-- the migration's assumed baseline, not a data problem and not an app-code
-- problem — no app code is touched by this fix.
--
-- FIX STRATEGY — do not hardcode another guessed baseline:
-- Rather than writing a second static list (which would just repeat 026's
-- mistake if production has drifted further than the facts given here),
-- this migration reads the CURRENT live constraint definition directly via
-- pg_get_constraintdef() at runtime, extracts its allowed values, unions
-- them with the 4 required Meta-capture values, and rebuilds the
-- constraint from that union. Nothing currently allowed (used or not) is
-- ever dropped — this migration can only add values, never remove them.
-- Safe to re-run (idempotent): re-running after the 4 new values are
-- already present is a no-op union.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT — run manually before this migration, for the record (this
-- migration also re-derives the same thing internally at runtime, so it
-- does not depend on this being run first — but run it anyway to see what
-- you're about to change):
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND contype = 'c' AND conname ILIKE '%source%';
--
--   SELECT source, COUNT(*) FROM leads GROUP BY source ORDER BY 2 DESC;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  current_def       text;
  current_values    text[];
  required_values   text[] := ARRAY['facebook_lead_ads','instagram_lead_ads','facebook_messenger','instagram_dm'];
  combined_values   text[];
  new_constraint_sql text;
BEGIN
  -- Read the constraint as it actually exists right now — not as any
  -- migration file assumes it to be.
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conrelid = 'leads'::regclass
    AND contype  = 'c'
    AND conname  = 'leads_source_check';

  IF current_def IS NULL THEN
    RAISE EXCEPTION 'leads_source_check not found on leads — aborting. Do not assume a baseline; report back with: SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ''leads''::regclass AND contype = ''c'';';
  END IF;

  -- Pull every single-quoted literal out of the constraint's normalized
  -- text form (e.g. CHECK (((source)::text = ANY ((ARRAY['website'::character varying, ...])::text[]))))
  -- — robust to the exact cast/formatting Postgres renders, since it only
  -- looks for '...' substrings.
  SELECT array_agg(m[1]) INTO current_values
  FROM regexp_matches(current_def, '''([^'']*)''', 'g') AS m;

  IF current_values IS NULL OR array_length(current_values, 1) IS NULL THEN
    RAISE EXCEPTION 'Could not parse any values out of leads_source_check definition: %. Aborting rather than guessing.', current_def;
  END IF;

  -- Union current (whatever it actually is) with the required new values.
  -- This can only ever grow the allowed set — nothing already allowed is
  -- ever removed by this migration.
  SELECT array_agg(DISTINCT v ORDER BY v) INTO combined_values
  FROM unnest(current_values || required_values) AS v;

  new_constraint_sql := format(
    'ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(v), ', ') FROM unnest(combined_values) AS v)
  );

  EXECUTE 'ALTER TABLE leads DROP CONSTRAINT leads_source_check';
  EXECUTE new_constraint_sql;

  RAISE NOTICE 'leads_source_check rebuilt. Previously allowed: %. Now allowed (%): %',
    current_values, array_length(combined_values, 1), combined_values;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT — run after COMMIT to confirm:
--
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'leads'::regclass AND conname = 'leads_source_check';
--
-- Expect every value that was allowed before this migration, still allowed,
-- PLUS: facebook_lead_ads, instagram_lead_ads, facebook_messenger,
-- instagram_dm. Check server output / NOTICE log from the DO block above
-- for the exact before/after lists if running interactively.
--
-- Then confirm the app-code half actually works end-to-end: trigger a test
-- Lead Ads submission or Messenger message against the connected Page (once
-- Meta credentials exist — see META_SETUP.md) and confirm a `leads` row is
-- created with the corresponding source value, not silently dropped.
-- ─────────────────────────────────────────────────────────────────────────────
