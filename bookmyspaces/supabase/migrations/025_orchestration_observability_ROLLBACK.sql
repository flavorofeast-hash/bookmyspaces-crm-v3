-- ─────────────────────────────────────────────────────────────────────────────
-- FILE: supabase/migrations/025_orchestration_observability_ROLLBACK.sql
-- Reverses 025_orchestration_observability.sql. Safe at any point before a
-- later Phase 1B step begins writing to orchestration_decisions or relying
-- on the unique index for isDuplicateDelivery -- as of this step, nothing
-- reads or writes either object, so dropping them back out has zero
-- downstream effect on the running application.
--
-- Reverse order of creation: drop the table (and its policy/indexes, which
-- go with it automatically) before the unified_messages index, mirroring
-- this repo's existing ROLLBACK file convention (e.g.
-- 013_proposal_reservation_links_ROLLBACK.sql undoing 013's additions
-- before 012's rollback drops the tables they reference).
--
-- If only the unique index turns out to be the problem post-deploy (see
-- the Step 2 Readiness Review, Section 11), it can also be dropped alone,
-- without running this whole file:
--   DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "orchestration_decisions_service_role_all" ON orchestration_decisions;
DROP TABLE IF EXISTS orchestration_decisions;

DROP INDEX IF EXISTS unified_messages_channel_external_id_uq;
