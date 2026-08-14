-- ROLLBACK for migration 028.
--
-- Removes exactly the 4 Meta-capture values 028 added
-- ('facebook_lead_ads','instagram_lead_ads','facebook_messenger',
-- 'instagram_dm') from whatever the constraint currently allows, leaving
-- everything else untouched. Deliberately does NOT restore any specific
-- hardcoded prior list (e.g. the 13-value list documented in 028's header)
-- — 028 itself proved that hardcoding an assumed baseline is exactly what
-- broke 026. This rollback instead reads the live constraint at runtime,
-- same as 028 did, and only subtracts the 4 values this migration pair is
-- responsible for.
--
-- WARNING: if any leads rows have been inserted with source IN
-- ('facebook_lead_ads','instagram_lead_ads','facebook_messenger',
-- 'instagram_dm') since migration 028 was applied, this rollback will FAIL
-- (the narrowed constraint would immediately be violated by those rows).
-- Check first:
--
--   SELECT source, COUNT(*) FROM leads
--   WHERE source IN ('facebook_lead_ads','instagram_lead_ads','facebook_messenger','instagram_dm')
--   GROUP BY source;
--
-- If any rows exist, decide what to do with them (e.g. UPDATE ... SET
-- source = 'other') before running this rollback, or leave 028 in place —
-- it is strictly more permissive than the pre-028 state, never less, so
-- leaving it applied carries no correctness risk.

BEGIN;

DO $$
DECLARE
  current_def      text;
  current_values   text[];
  remove_values    text[] := ARRAY['facebook_lead_ads','instagram_lead_ads','facebook_messenger','instagram_dm'];
  restored_values  text[];
  new_constraint_sql text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conrelid = 'leads'::regclass
    AND contype  = 'c'
    AND conname  = 'leads_source_check';

  IF current_def IS NULL THEN
    RAISE EXCEPTION 'leads_source_check not found on leads — aborting rollback rather than guessing.';
  END IF;

  SELECT array_agg(m[1]) INTO current_values
  FROM regexp_matches(current_def, '''([^'']*)''', 'g') AS m;

  IF current_values IS NULL OR array_length(current_values, 1) IS NULL THEN
    RAISE EXCEPTION 'Could not parse any values out of leads_source_check definition: %. Aborting rather than guessing.', current_def;
  END IF;

  SELECT array_agg(DISTINCT v ORDER BY v) INTO restored_values
  FROM unnest(current_values) AS v
  WHERE v <> ALL(remove_values);

  IF restored_values IS NULL OR array_length(restored_values, 1) IS NULL THEN
    RAISE EXCEPTION 'Refusing to rebuild leads_source_check with an empty allowed list — aborting.';
  END IF;

  new_constraint_sql := format(
    'ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source IN (%s))',
    (SELECT string_agg(quote_literal(v), ', ') FROM unnest(restored_values) AS v)
  );

  EXECUTE 'ALTER TABLE leads DROP CONSTRAINT leads_source_check';
  EXECUTE new_constraint_sql;

  RAISE NOTICE 'leads_source_check rolled back. Removed: %. Now allowed (%): %',
    remove_values, array_length(restored_values, 1), restored_values;
END $$;

COMMIT;
