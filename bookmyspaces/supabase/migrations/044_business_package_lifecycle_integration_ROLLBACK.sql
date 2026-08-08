-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — MIGRATION 044: Business Package Engine — CRM-wide integration
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE ad_spend DROP COLUMN IF EXISTS business_package_id;
ALTER TABLE reservations DROP COLUMN IF EXISTS business_package_id;
ALTER TABLE leads DROP COLUMN IF EXISTS business_package_id;

COMMIT;
