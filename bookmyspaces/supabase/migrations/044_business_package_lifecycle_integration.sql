-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 044: Business Package Engine — CRM-wide integration
-- File  : 044_business_package_lifecycle_integration.sql
--
-- PURPOSE:
-- Migration 043 introduced `business_packages` and linked `social_posts` and
-- `proposals` to it. This migration completes the customer-lifecycle chain
-- so a Business Package can be the primary entity driving it end to end:
--   leads -> proposals (already linked, 043) -> reservations -> ad spend
--
-- REUSE OVER DUPLICATE: three nullable, additive FK columns only. No new
-- tables. Every consumer (revenue-intelligence.ts's campaign-ROI pattern,
-- campaigns.ts's segment logic, the Marketing Dashboard) already reads
-- leads/reservations/ad_spend directly — this only gives them one more
-- column to group by, same "fetch once, reduce in JS" contract already
-- established throughout this codebase.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS business_package_id UUID REFERENCES business_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_business_package_id ON leads(business_package_id);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS business_package_id UUID REFERENCES business_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_business_package_id ON reservations(business_package_id);

-- ROI by Business Package needs spend data attributable to a package, not
-- just a free-text campaign_name. Optional — existing ad_spend rows (and
-- any future row that doesn't set it) simply aren't included in the
-- package-level ROI breakdown, same "honest, never fabricated" posture
-- ad-spend-service.ts already documents for missing data.
ALTER TABLE ad_spend
  ADD COLUMN IF NOT EXISTS business_package_id UUID REFERENCES business_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ad_spend_business_package_id ON ad_spend(business_package_id);

COMMENT ON COLUMN leads.business_package_id IS
  'Business Package Engine — set at capture time (package-driven landing page) or manually by an operator. Inherited onto any proposal created from this lead.';
COMMENT ON COLUMN reservations.business_package_id IS
  'Business Package Engine — inherited from the originating proposal at creation time (same snapshot convention as reservations.package_name/venue). NULL for a walk-in reservation.';
COMMENT ON COLUMN ad_spend.business_package_id IS
  'Business Package Engine — optional attribution so spend can be rolled up into ROI-by-package. NULL means this spend row is not attributed to a specific package.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'business_package_id';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'business_package_id';
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_spend' AND column_name = 'business_package_id';
-- Expect 1 row each.
-- ─────────────────────────────────────────────────────────────────────────────
