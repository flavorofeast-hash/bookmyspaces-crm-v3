-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — MIGRATION 043: Business Package Engine
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE proposals DROP COLUMN IF EXISTS business_package_id;
ALTER TABLE social_posts DROP COLUMN IF EXISTS business_package_id;

DROP TRIGGER IF EXISTS update_business_packages_updated_at ON business_packages;
DROP TABLE IF EXISTS business_packages;

COMMIT;
