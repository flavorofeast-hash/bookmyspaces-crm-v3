-- ROLLBACK for 019_stage_transitions.sql
-- Drops the stage_transitions table and its policy/indexes. Safe: this
-- table is written to best-effort (try/catch) by lead-stage-manager.ts, so
-- dropping it does not break stage transitions themselves, only their
-- history log and the Sales Funnel's "average time between stages" metric.

DROP POLICY IF EXISTS "stage_transitions_service_role_all" ON stage_transitions;
DROP TABLE IF EXISTS stage_transitions;
