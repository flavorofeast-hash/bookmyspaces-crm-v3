-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 027: Missing indexes on foreign-key columns
-- File  : 027_missing_fk_indexes.sql
--
-- PURPOSE:
-- Full read-through of migrations 001-026 (non-rollback files) found 18
-- UUID foreign-key columns (REFERENCES other_table(id)) with no covering
-- index anywhere in the migration history (an index counts if the FK
-- column is the leading column of a multi-column/unique index). Missing FK
-- indexes mean slow joins on these columns and full-table scans whenever
-- Postgres checks for dependent rows on a parent-row UPDATE/DELETE.
--
-- 100% additive: only CREATE INDEX IF NOT EXISTS statements, no existing
-- column, constraint, or index touched.
--
-- Every column below was personally verified against the actual CREATE
-- INDEX / CREATE UNIQUE INDEX statements in migrations 001-026 — not
-- assumed from naming conventions. Full audit trail (checked vs missing)
-- is in the PR/commit description, not repeated here.
--
-- CORRECTED (production drift, verified against live production, not
-- assumed):
--   - message_queue table              (migration 002) — does not exist
--   - blocked_dates table               (migration 003) — does not exist
--   - orchestration_decisions table     (migration 025) — does not exist
--   - escalations.conversation_id column (migration 007) — does not exist
-- This repo's migration history defines all four, but production does not
-- match that history. CREATE INDEX on a nonexistent table/column fails
-- migration, so all four entries are removed here, leaving 14 indexes for
-- foreign-key columns confirmed to exist on the live schema. If any of
-- these are added to production later, their FK indexes should be a
-- separate migration at that time, not restored here blind.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a BEGIN/COMMIT block —
-- this repo's own convention (migrations 009/010/011/017/026) is a single
-- plain-transaction migration, matched here. All tables below are low/
-- medium write volume; the brief lock a plain CREATE INDEX takes is
-- acceptable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- bookings.lead_id -> leads(id)                    (migration 003)
CREATE INDEX IF NOT EXISTS idx_bookings_lead_id ON bookings(lead_id);

-- bookings.proposal_id -> proposals(id)            (migration 003)
CREATE INDEX IF NOT EXISTS idx_bookings_proposal_id ON bookings(proposal_id);

-- leads.imported_via_import_id -> lead_imports(id) (migration 018, conditional FK)
CREATE INDEX IF NOT EXISTS idx_leads_imported_via_import_id ON leads(imported_via_import_id);

-- unified_conversations.first_touch_channel_id -> channels(id) (migration 012)
CREATE INDEX IF NOT EXISTS idx_unified_conversations_first_touch_channel_id ON unified_conversations(first_touch_channel_id);

-- reservations.meal_plan_id -> meal_plans(id)      (migration 012)
CREATE INDEX IF NOT EXISTS idx_reservations_meal_plan_id ON reservations(meal_plan_id);

-- reservations.proposal_id -> proposals(id)        (migration 012)
CREATE INDEX IF NOT EXISTS idx_reservations_proposal_id ON reservations(proposal_id);

-- reservations.invoice_id -> invoices(id)          (migration 012)
CREATE INDEX IF NOT EXISTS idx_reservations_invoice_id ON reservations(invoice_id);

-- reservation_addons.addon_service_id -> addon_services(id) (migration 012)
CREATE INDEX IF NOT EXISTS idx_reservation_addons_addon_service_id ON reservation_addons(addon_service_id);

-- proposals.inventory_item_id -> inventory_items(id) (migration 013)
CREATE INDEX IF NOT EXISTS idx_proposals_inventory_item_id ON proposals(inventory_item_id);

-- social_interactions.account_id -> social_accounts(id) (migration 014)
CREATE INDEX IF NOT EXISTS idx_social_interactions_account_id ON social_interactions(account_id);

-- social_interactions.conversation_id -> unified_conversations(id) (migration 014)
CREATE INDEX IF NOT EXISTS idx_social_interactions_conversation_id ON social_interactions(conversation_id);

-- social_posts.account_id -> social_accounts(id)   (migration 014)
CREATE INDEX IF NOT EXISTS idx_social_posts_account_id ON social_posts(account_id);

-- reviews.customer_id -> leads(id)                 (migration 014)
CREATE INDEX IF NOT EXISTS idx_reviews_customer_id ON reviews(customer_id);

-- packages.meal_plan_id -> meal_plans(id)          (migration 023)
CREATE INDEX IF NOT EXISTS idx_packages_meal_plan_id ON packages(meal_plan_id);

COMMIT;
