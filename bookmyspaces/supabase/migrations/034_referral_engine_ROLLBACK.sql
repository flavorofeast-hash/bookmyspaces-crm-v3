-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 034_referral_engine.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referral_codes;

COMMIT;
