-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES V3 — RC1 CATALOG TEST DATA SEED
--
-- Generated for RC1 test-data population (Rate Plans / Meal Plans / Add-ons /
-- Event Packages testing). NOT executed — review then run yourself (Supabase
-- SQL Editor or `psql -f`) once migrations 007, 012, 013, 023, 024 are
-- confirmed applied (rate_plans/inventory_items/meal_plans/addon_services
-- come from 012; packages' hall/seating_style/addon_service_ids columns come
-- from 023/024 — see RC1_DEPLOYMENT_READINESS.md for current apply status).
--
-- Existing schema only — no ALTER/CREATE TABLE, no new columns, no app code
-- touched. Uses the two properties already seeded by migration 012
-- (skyline-serenity, monurama-homestay) — does not create new properties.
--
-- SCHEMA VERIFIED (live Supabase, not migrations): inventory_items,
-- meal_plans, rate_plans, addon_services columns below match the verified
-- live column list exactly. packages also verified — real columns are id,
-- name, slug, property, type, price, price_note, duration, capacity_min,
-- capacity_max, inclusions, is_popular, is_active, sort_order, event_types,
-- images, room_inventory_item_ids, meal_plan_id, tax_rate_override_pct,
-- hall, seating_style, addon_service_ids, seasonal_pricing,
-- standard_discount_pct — no venue/tier/base_price/max_guests/
-- duration_hours/description/ai_description (those were migration-file-only,
-- per BUG-003). `property` is free text; `type` is constrained to
-- 'dining' | 'rooftop' (verified) — both used accordingly below.
-- `images`, `tax_rate_override_pct`, `seasonal_pricing` left unset
-- (table defaults/NULL) — no data was requested for them.
--
-- Idempotency: every INSERT uses fixed UUIDs + ON CONFLICT (id) DO NOTHING,
-- same convention as supabase/seed/staging_seed.sql — safe to re-run.
-- Distinct UUID prefix block (90/91/92/93/94-...) from staging_seed.sql's
-- (a0/b0/c0/d0-...) so the two seed files can both be run without collision.
--
-- Scope, per request:
--   Monurama Homestay: 4 rooms, 1 banquet hall, 1 rooftop
--   Skyline Serenity:  4 rooms
--   3 rate plans, 3 meal plans, 5 add-on services, 3 event packages
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. INVENTORY ITEMS — Monurama (4 rooms + hall + rooftop), Skyline (4 rooms)
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO inventory_items (id, property_id, inventory_type, name, description, max_occupancy, base_capacity, is_active)
SELECT * FROM (VALUES
  -- Monurama Homestay
  ('90000000-0000-0000-0000-000000000001'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'room', 'Room 101', 'Ground-floor double room', 2, 2, true),
  ('90000000-0000-0000-0000-000000000002'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'room', 'Room 102', 'Ground-floor double room', 2, 2, true),
  ('90000000-0000-0000-0000-000000000003'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'room', 'Room 201', 'First-floor double room, balcony', 3, 2, true),
  ('90000000-0000-0000-0000-000000000004'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'room', 'Room 202', 'First-floor double room, balcony', 3, 2, true),
  ('90000000-0000-0000-0000-000000000005'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'banquet_hall', 'Banquet Hall', 'Indoor hall, stage + AV', 150, 100, true),
  ('90000000-0000-0000-0000-000000000006'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'rooftop', 'Rooftop', 'Open-air rooftop venue', 80, 60, true),
  -- Skyline Serenity
  ('90000000-0000-0000-0000-000000000007'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'room', 'Room 101', 'City-view double room', 2, 2, true),
  ('90000000-0000-0000-0000-000000000008'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'room', 'Room 102', 'City-view double room', 2, 2, true),
  ('90000000-0000-0000-0000-000000000009'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'room', 'Room 103', 'Airport-side double room', 2, 2, true),
  ('9000000a-0000-0000-0000-000000000010'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'room', 'Room 104', 'Airport-side double room', 2, 2, true)
) AS v(id, property_id, inventory_type, name, description, max_occupancy, base_capacity, is_active)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. MEAL PLANS (3) — UNIQUE(property_id, code), no fixed-code duplicates
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO meal_plans (id, property_id, code, name, description, price, is_active)
SELECT * FROM (VALUES
  ('91000000-0000-0000-0000-000000000001'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'breakfast', 'Breakfast (CP)', 'Home-style Bengali breakfast', 350::numeric, true),
  ('91000000-0000-0000-0000-000000000002'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'map', 'Breakfast + 1 Meal (MAP)', 'Breakfast plus dinner', 650::numeric, true),
  ('91000000-0000-0000-0000-000000000003'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'breakfast', 'Breakfast (CP)', 'Complimentary buffet breakfast', 300::numeric, true)
) AS v(id, property_id, code, name, description, price, is_active)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RATE PLANS (3) — base + weekend uplift on Monurama Room 101, base on
--    Skyline Room 101
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO rate_plans (id, inventory_item_id, rate_type, start_date, end_date, price, priority, is_active)
SELECT * FROM (VALUES
  ('92000000-0000-0000-0000-000000000001'::uuid, '90000000-0000-0000-0000-000000000001'::uuid, 'base',    NULL::date, NULL::date, 3200::numeric, 0,  true),
  ('92000000-0000-0000-0000-000000000002'::uuid, '90000000-0000-0000-0000-000000000001'::uuid, 'weekend', NULL::date, NULL::date, 3800::numeric, 10, true),
  ('92000000-0000-0000-0000-000000000003'::uuid, '90000000-0000-0000-0000-000000000007'::uuid, 'base',    NULL::date, NULL::date, 2800::numeric, 0,  true)
) AS v(id, inventory_item_id, rate_type, start_date, end_date, price, priority, is_active)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ADD-ON SERVICES (5)
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO addon_services (id, property_id, name, category, price, is_active)
SELECT * FROM (VALUES
  ('93000000-0000-0000-0000-000000000001'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'Airport Pickup', 'transport', 800::numeric, true),
  ('93000000-0000-0000-0000-000000000002'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'Birthday Decoration', 'decoration', 1500::numeric, true),
  ('93000000-0000-0000-0000-000000000003'::uuid, (SELECT id FROM properties WHERE slug = 'monurama-homestay'), 'Photography (2 hours)', 'photography', 3000::numeric, true),
  ('93000000-0000-0000-0000-000000000004'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'Airport Pickup', 'transport', 900::numeric, true),
  ('93000000-0000-0000-0000-000000000005'::uuid, (SELECT id FROM properties WHERE slug = 'skyline-serenity'), 'Extra Bed', 'accommodation', 500::numeric, true)
) AS v(id, property_id, name, category, price, is_active)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. EVENT PACKAGES (3) — matches verified live columns. `type` restricted
--    to the verified enum ('dining' | 'rooftop'); `property` is free text.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO packages (
  id, name, slug, property, type, price, price_note, duration,
  capacity_min, capacity_max, inclusions, is_popular, is_active, sort_order,
  event_types, room_inventory_item_ids, meal_plan_id, addon_service_ids,
  hall, seating_style, standard_discount_pct
)
SELECT * FROM (VALUES
  (
    '94000000-0000-0000-0000-000000000001'::uuid, 'Sunset Rooftop Party', 'sunset-rooftop-party',
    'monurama_rooftop', 'rooftop', 45000::numeric, 'Per event, up to base guest count', 4,
    30, 60,
    ARRAY['Rooftop venue (4 hours)', 'Standard decoration', 'Buffet dinner', 'Sound system'],
    true, true, 1,
    ARRAY['BIRTHDAY', 'ANNIVERSARY', 'PRIVATE_PARTY'],
    ARRAY['90000000-0000-0000-0000-000000000006'::uuid],
    '91000000-0000-0000-0000-000000000001'::uuid,
    ARRAY['93000000-0000-0000-0000-000000000003'::uuid],
    NULL, 'Floating', 5::numeric
  ),
  (
    '94000000-0000-0000-0000-000000000002'::uuid, 'Celebration Hall Wedding', 'celebration-hall-wedding',
    'monurama_dining', 'dining', 85000::numeric, 'Per event, up to base guest count', 6,
    80, 150,
    ARRAY['Hall venue (6 hours)', 'Premium decoration', 'Full buffet', 'Stage setup'],
    false, true, 2,
    ARRAY['WEDDING', 'RECEPTION', 'ENGAGEMENT'],
    ARRAY['90000000-0000-0000-0000-000000000005'::uuid],
    '91000000-0000-0000-0000-000000000002'::uuid,
    ARRAY['93000000-0000-0000-0000-000000000002'::uuid, '93000000-0000-0000-0000-000000000003'::uuid],
    'Monurama Celebration Hall', 'Round Table', 8::numeric
  ),
  (
    '94000000-0000-0000-0000-000000000003'::uuid, 'Skyline Corporate Meet', 'skyline-corporate-meet',
    'skyline', 'dining', 32000::numeric, 'Per event, up to base guest count', 5,
    20, 100,
    ARRAY['Meeting venue (5 hours)', 'Projector & mic', 'Working lunch'],
    false, true, 3,
    ARRAY['CORPORATE_MEETING', 'CONFERENCE'],
    '{}'::uuid[],
    '91000000-0000-0000-0000-000000000003'::uuid,
    ARRAY['93000000-0000-0000-0000-000000000004'::uuid],
    NULL, 'Theatre', NULL
  )
) AS v(
  id, name, slug, property, type, price, price_note, duration,
  capacity_min, capacity_max, inclusions, is_popular, is_active, sort_order,
  event_types, room_inventory_item_ids, meal_plan_id, addon_service_ids,
  hall, seating_style, standard_discount_pct
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- Verification query — run after this script to confirm row counts
-- ─────────────────────────────────────────────────────────────────────────
-- select
--   (select count(*) from inventory_items where id::text like '90000000%' or id::text like '9000000a%') as inventory_items,
--   (select count(*) from meal_plans      where id::text like '91000000%') as meal_plans,
--   (select count(*) from rate_plans      where id::text like '92000000%') as rate_plans,
--   (select count(*) from addon_services  where id::text like '93000000%') as addon_services,
--   (select count(*) from packages        where id::text like '94000000%') as packages;
-- Expected: 10, 3, 3, 5, 3
