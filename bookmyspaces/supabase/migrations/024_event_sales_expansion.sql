-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 024 — Direct Event Sales Engine, business-strategy expansion.
--
-- WHY:
--   - The updated directive's expanded package field list (Hall, Seating
--     Style, Seasonal Pricing, a catalog-level standard Discount, and
--     linked Add-on Services) has no home on `packages` yet. Most of the
--     directive's list already maps onto existing columns — Venue
--     (venue), Capacity (max_guests), Menu (meal_plan_id, migration 023),
--     Rooms (room_inventory_item_ids, migration 023), Taxes
--     (tax_rate_override_pct, migration 023), Images/AI Description
--     (migration 023) — see package-service.ts's header for the reuse
--     rationale. Hall, Seating Style, and Seasonal Pricing are genuinely
--     new concepts with nowhere to live.
--   - `addon_services` (migration 012) is already the reusable catalog for
--     Photography/Videography/DJ/Sound System/Lighting/Parking/Welcome
--     Drinks — `proposals.addon_service_ids` (migration 013) already
--     references it. `packages` needs the same array column so a package
--     can declare which catalog services it includes, mirroring the
--     already-proven `room_inventory_item_ids`/`meal_plan_id` pattern
--     (migration 023) instead of adding a duplicate set of boolean flags
--     per service.
--   - `proposals.hall` mirrors `proposals.venue` so accepted proposals can
--     be grouped "by Hall" on the Event Revenue Dashboard the same way
--     they're already grouped by venue/package/event_type.
--   - `ai_interaction_log.interaction_type` (migration 012) is a fixed
--     CHECK enum. Two values the app has been writing since earlier this
--     project are NOT in it — 'upsell_recommendations' (P1.3, added
--     pre-DESE) and 'event_sales_advisor' (DESE Section 2/7) — so every
--     insert for those two AI actions has been failing the CHECK
--     constraint and silently swallowed by logInteraction()'s
--     fault-tolerant try/catch (the log write was never the correctness
--     path, so nothing else broke). This migration adds both missing
--     values so those rows actually persist — required for this phase's
--     new "AI Recommendation Success Rate" dashboard metric, which reads
--     ai_interaction_log for 'event_sales_advisor' rows.
--
-- Additive and idempotent; ROLLBACK file alongside.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS hall TEXT,
  ADD COLUMN IF NOT EXISTS seating_style TEXT,
  ADD COLUMN IF NOT EXISTS addon_service_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seasonal_pricing JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS standard_discount_pct NUMERIC(5,2);

COMMENT ON COLUMN packages.addon_service_ids IS 'References addon_services(id) — same not-DB-enforced-array-FK convention as proposals.addon_service_ids (migration 013), validated app-side in src/lib/packages/package-service.ts.';
COMMENT ON COLUMN packages.seasonal_pricing IS 'Array of {label, startDate, endDate, priceAdjustmentPct} — additive seasonal pricing rules, applied app-side, base_price is never mutated by a rule.';
COMMENT ON COLUMN packages.standard_discount_pct IS 'Catalog-level default discount hint the Smart Proposal Generator can pre-fill into a proposal''s discount_amount — the proposal''s own discount_amount/discount_reason (migration 003) remain the actual per-deal negotiated value and are never overwritten once set.';

CREATE INDEX IF NOT EXISTS idx_packages_hall ON packages(hall);

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS hall TEXT;

CREATE INDEX IF NOT EXISTS idx_proposals_hall ON proposals(hall);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_interaction_log_interaction_type_check') THEN
    ALTER TABLE ai_interaction_log DROP CONSTRAINT ai_interaction_log_interaction_type_check;
  END IF;

  ALTER TABLE ai_interaction_log
    ADD CONSTRAINT ai_interaction_log_interaction_type_check
    CHECK (interaction_type IN (
      'customer_summary', 'conversation_summary', 'suggested_whatsapp_reply',
      'suggested_email', 'recommended_room', 'recommended_package', 'recommended_follow_up',
      'upsell_recommendations', 'event_sales_advisor'
    ));
END $$;
