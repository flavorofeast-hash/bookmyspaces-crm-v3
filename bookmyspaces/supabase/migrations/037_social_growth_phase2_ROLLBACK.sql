-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 037_social_growth_phase2.sql
-- Drops the four Phase 2 tables in dependency order. Purely additive
-- migration — nothing else needs to be restored.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS drip_sequence_enrollments;
DROP TABLE IF EXISTS drip_sequence_steps;
DROP TABLE IF EXISTS drip_sequences;
DROP TABLE IF EXISTS social_post_metrics;

COMMIT;
