-- ─────────────────────────────────────────────────────────────────────────────
-- FILE: scripts/verify-packages-columns.sql
-- Read-only live-schema verification for the `packages` table's CORE columns
-- (not the 023/024 extensions, which scripts/verify-migration-023.sql /
-- verify-migrations-012-013-016-017-024.sql already cover).
--
-- WHY THIS EXISTS: docs/engineering/MASTER_DATABASE.md records a confirmed
-- RC1-session finding that the live `packages` table's actual columns
-- (slug, property, type, price, price_note, duration, capacity_min,
-- capacity_max, sort_order, ...) did NOT match what migrations 007/023/024
-- describe (venue, tier, base_price, max_guests, duration_hours,
-- description, ai_description). This was flagged in MASTER_DATABASE.md but
-- under-weighted in PRODUCTION_VERIFICATION_REPORT.md's original Package/
-- Pricing grade (corrected there, dated addendum, same pass that produced
-- this file) — package-service.ts's mapPackageRow() reads row.venue/
-- row.base_price/row.max_guests by name; if those columns don't exist live
-- under those names, every package silently maps to venue: undefined,
-- basePrice: 0, maxGuests: 60 (default). This is NOT a graceful
-- degradation: venue: undefined means the Skyline-never-events and
-- Monurama-100-cap guards in auto-package-recommendation.ts silently never
-- fire (their condition is `if (pkg.venue && ...)`), and basePrice: 0 means
-- every AI-drafted proposal prices at ~₹0. This is the single highest-
-- priority check in this entire verification suite.
--
-- 2026-08-02 FIX (post-migration-028 TL;DR bug): the original TL;DR logic
-- lumped `slug`/`type` in with `property`/`price`/`capacity_max` under one
-- "RC1 live-schema finding" bucket and flagged drift if ANY of the five
-- existed. That's wrong: `slug` and `type` are legitimate additional
-- columns on the live table (not part of any migration file, but also not
-- a replacement name for venue/base_price/max_guests) — their presence is
-- informational, not a drift signal. After migration 028 renamed
-- property→venue, price→base_price, capacity_max→max_guests, `slug`/`type`
-- were untouched and still exist, which made the old logic keep reporting
-- "CONFIRMED: drift" even though the actual replacement columns were gone.
-- The TL;DR now checks ONLY property/price/capacity_max for the drift
-- verdict; `slug`/`type` (and `tier`/`duration_hours`) are still checked
-- and shown in the detail rows below, but do not affect the TL;DR result.
--
-- GUARANTEES: read-only, information_schema only, no application data read,
-- safe to run any number of times.
-- ─────────────────────────────────────────────────────────────────────────────

WITH checks(check_name, expected_by, passed) AS (
  VALUES
  -- The columns the application code actually reads by name (package-service.ts mapPackageRow)
  ('packages.venue exists',       'application code (Property Intelligence guard depends on this)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='venue')),
  ('packages.base_price exists',  'application code (proposal pricing depends on this)',             EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='base_price')),
  ('packages.max_guests exists',  'application code (capacity guard depends on this)',                EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='max_guests')),

  -- Informational only, migration 007 — NOT part of the venue/base_price/
  -- max_guests rename this script's TL;DR is scoped to. Shown for
  -- completeness; does not gate the TL;DR verdict.
  ('packages.tier exists',        'migration 007 (informational only)',  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='tier')),
  ('packages.duration_hours exists', 'migration 007 (informational only)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='duration_hours')),

  -- The 3 columns MASTER_DATABASE.md's RC1 finding says existed live INSTEAD
  -- of venue/base_price/max_guests (a disjoint naming scheme covering the
  -- SAME concept under a different name). These are the only columns that
  -- should ever flip the TL;DR to "drift confirmed" — their presence means
  -- the live table is still using the pre-migration-028 names.
  ('packages.property exists (replacement name for venue — drift indicator)',           'RC1 live-schema finding (replacement column)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='property')),
  ('packages.price exists (replacement name for base_price — drift indicator)',         'RC1 live-schema finding (replacement column)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='price')),
  ('packages.capacity_max exists (replacement name for max_guests — drift indicator)',  'RC1 live-schema finding (replacement column)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='capacity_max')),

  -- Legitimate ADDITIONAL columns on the live table — not a replacement for
  -- any application-expected name, so their presence is informational only
  -- and must NOT trigger a drift verdict on its own.
  ('packages.slug exists (additional column, not a replacement — informational only)',  'RC1 live-schema finding (additional column)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='slug')),
  ('packages.type exists (additional column, not a replacement — informational only)',  'RC1 live-schema finding (additional column)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='type'))
),
rollup AS (
  SELECT
    -- Only the 3 columns the application actually reads by name gate the
    -- "matches application code" verdict. tier/duration_hours are checked
    -- above for visibility but intentionally excluded here — they aren't
    -- part of the venue/base_price/max_guests rename this script verifies.
    -- (CASE-based conditional aggregation, not the FILTER (WHERE ...)
    -- clause, for maximum portability — same semantics: bool_and/bool_or
    -- ignore NULLs, so a non-matching row contributes nothing either way.)
    bool_and(CASE WHEN expected_by LIKE 'application code%' THEN passed END) AS app_columns_present,
    -- Only the 3 true replacement columns gate the "drift confirmed"
    -- verdict. slug/type are deliberately excluded — see the 2026-08-02
    -- header note above.
    bool_or(CASE WHEN expected_by = 'RC1 live-schema finding (replacement column)' THEN passed END) AS replacement_columns_present
  FROM checks
)
SELECT 'TL;DR' AS section, '' AS check_name, '' AS expected_by,
  CASE
    WHEN replacement_columns_present THEN 'CONFIRMED: packages table still uses at least one RC1-documented replacement column name (property/price/capacity_max) instead of venue/base_price/max_guests. Property Intelligence guards silently no-op and proposal pricing computes as ~0 until code or schema is reconciled. DO NOT LAUNCH until this is resolved.'
    WHEN app_columns_present THEN 'packages table matches application code -- venue/base_price/max_guests all present and none of the old replacement names (property/price/capacity_max) remain. Property Intelligence guards and proposal pricing are safe. (tier/duration_hours/slug/type are reported below for information only and do not affect this result.)'
    ELSE 'INCONCLUSIVE: neither venue/base_price/max_guests (all three) nor any RC1-documented replacement column is fully/currently present -- packages schema does not match either expected shape. Re-run a full information_schema inspection before launch.'
  END AS result,
  0 AS sort_key
FROM rollup
UNION ALL
SELECT '2_DETAIL', c.check_name, c.expected_by, CASE WHEN c.passed THEN 'PRESENT' ELSE 'ABSENT' END, 1
FROM checks c
ORDER BY sort_key, check_name;
