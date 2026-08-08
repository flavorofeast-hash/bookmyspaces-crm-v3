-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — MIGRATION 042: Event Post-Experience Lifecycle
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP INDEX IF EXISTS idx_loyalty_transactions_proposal_award;
DROP INDEX IF EXISTS idx_review_requests_proposal_id;
ALTER TABLE review_requests DROP COLUMN IF EXISTS proposal_id;

COMMIT;
