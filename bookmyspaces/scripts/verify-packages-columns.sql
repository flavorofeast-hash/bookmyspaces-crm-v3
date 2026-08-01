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
-- GUARANTEES: read-only, information_schema only, no application data read,
-- safe to run any number of times.
-- ─────────────────────────────────────────────────────────────────────────────

WITH checks(check_name, expected_by, passed) AS (
  VALUES
  -- The columns the application code actually reads by name (package-service.ts mapPackageRow)
  ('packages.venue exists',       'application code (Property Intelligence guard depends on this)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='venue')),
  ('packages.base_price exists',  'application code (proposal pricing depends on this)',             EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='base_price')),
  ('packages.max_guests exists',  'application code (capacity guard depends on this)',                EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='max_guests')),
  ('packages.tier exists',        'migration 007',  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='tier')),
  ('packages.duration_hours exists', 'migration 007', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='duration_hours')),

  -- The columns MASTER_DATABASE.md's RC1 finding says exist live INSTEAD (a
  -- different, disjoint naming scheme) -- if these are TRUE and the block
  -- above is FALSE, that confirms the documented drift is still current.
  ('packages.property exists (possible live-only name for venue)',    'RC1 live-schema finding', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='property')),
  ('packages.price exists (possible live-only name for base_price)',  'RC1 live-schema finding', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='price')),
  ('packages.capacity_max exists (possible live-only name for max_guests)', 'RC1 live-schema finding', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='capacity_max')),
  ('packages.slug exists (RC1 finding, not in any migration)',   'RC1 live-schema finding', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='slug')),
  ('packages.type exists (RC1 finding, not in any migration)',   'RC1 live-schema finding', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='type'))
),
rollup AS (
  SELECT
    bool_and(passed) FILTER (WHERE expected_by LIKE 'application code%' OR expected_by = 'migration 007') AS app_columns_present,
    bool_or(passed) FILTER (WHERE expected_by = 'RC1 live-schema finding') AS drift_columns_present
  FROM checks
)
SELECT 'TL;DR' AS section, '' AS check_name, '' AS expected_by,
  CASE
    WHEN app_columns_present THEN 'packages table matches application code -- venue/base_price/max_guests all present. Property Intelligence guards and proposal pricing are safe.'
    WHEN drift_columns_present THEN 'CONFIRMED: packages table still uses the RC1-documented alternate column names. Property Intelligence guards silently no-op and proposal pricing computes as ~0 until code or schema is reconciled. DO NOT LAUNCH until this is resolved.'
    ELSE 'Neither expected nor RC1-documented columns fully present -- packages schema has changed again since the last check. Re-run full information_schema inspection before launch.'
  END AS result,
  0 AS sort_key
FROM rollup
UNION ALL
SELECT '2_DETAIL', c.check_name, c.expected_by, CASE WHEN c.passed THEN 'PRESENT' ELSE 'ABSENT' END, 1
FROM checks c
ORDER BY sort_key, check_name;
