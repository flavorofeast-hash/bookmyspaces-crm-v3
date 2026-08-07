-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 033_review_engine.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS review_requests;
ALTER TABLE reviews DROP COLUMN IF EXISTS reservation_id;

COMMIT;
