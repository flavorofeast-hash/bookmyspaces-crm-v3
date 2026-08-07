-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 035_loyalty_foundation.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS loyalty_transactions;
DROP TABLE IF EXISTS loyalty_accounts;
DROP TABLE IF EXISTS loyalty_tier_rules;

COMMIT;
