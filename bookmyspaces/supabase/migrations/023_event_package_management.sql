-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 023 — Event Package Management (Direct Event Sales Engine, Section 3).
--
-- WHY EXTEND, NOT BUILD NEW: the audit found `packages` (migration 007)
-- already live and read by the WhatsApp pricing reply, getActivePackagePrices()
-- and AI context — a real, reusable venue-package concept, just thin
-- (venue+capacity+base price+addons-as-JSON only). Rather than a parallel
-- "event_packages" table, this extends the existing one.
--
-- REUSE OVER DUPLICATE: menu/catering already has a first-class model —
-- `meal_plans` (migration 012) — so this links to it via meal_plan_id
-- instead of inventing a second menu concept. Rooms already have a
-- first-class model — `inventory_items` — linked via room_inventory_item_ids.
-- Photography/decoration/DJ don't need new columns: the existing
-- `addons JSONB [{name,price,description}]` column already models exactly
-- this (arbitrary priced line items) — operators add "Photography",
-- "DJ", "Premium Decoration" as addon rows, same as before. Tax reuses
-- src/lib/tax.ts's DEFAULT_TAX_RATE_PERCENT as the fallback, with an
-- optional per-package override for packages that are contractually taxed
-- differently.
--
-- NEW: event_types (which of the directive's 10 event types this package
-- applies to — NULL/empty = applies to all), images (Content Studio /
-- proposal use), room_inventory_item_ids, meal_plan_id, tax_rate_override_pct.
-- Also adds proposals.package_id so proposals generated from a package keep
-- a real FK back to it (Section 4 — Smart Proposal Generator needs this to
-- know which package a proposal came from; previously package_name was a
-- free-text label only).
--
-- Additive and idempotent; ROLLBACK file alongside.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS event_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS room_inventory_item_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_rate_override_pct NUMERIC(5,2);

CREATE INDEX IF NOT EXISTS idx_packages_event_types ON packages USING GIN(event_types);

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_package_id ON proposals(package_id);
