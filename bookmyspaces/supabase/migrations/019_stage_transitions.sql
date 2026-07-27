-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 019 — stage_transitions table.
--
-- WHY: src/modules/leads/lead-stage-manager.ts's transitionStage() (live,
-- called from POST /api/leads/[id]/stage on every kanban drag / stage
-- change) has been writing to a `stage_transitions` table since that code
-- was built — wrapped in try/catch as a best-effort audit trail, so its
-- absence has never broken a stage change, just silently discarded the
-- history every time. Confirmed via full-repo + full-migration-history
-- search: no CREATE TABLE for stage_transitions exists anywhere before this
-- file. This migration only completes infrastructure the application code
-- already assumes exists — no new business logic, no new write path.
--
-- WHY IT MATTERS NOW: Revenue Intelligence's Sales Funnel ("average time
-- between stages") has no other source for this — leads.updated_at is a
-- single timestamp per row, not a per-transition history. Once this table
-- is live, that metric starts populating from real transitions going
-- forward (it cannot be back-filled for transitions that already happened
-- and were discarded before this migration).
--
-- Additive and idempotent; ROLLBACK file alongside, per this repo's
-- established migration convention.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stage_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  reason TEXT,
  performed_by TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead_id ON stage_transitions(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_to_stage ON stage_transitions(to_stage);

ALTER TABLE stage_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stage_transitions_service_role_all" ON stage_transitions;
CREATE POLICY "stage_transitions_service_role_all" ON stage_transitions
  FOR ALL USING (auth.role() = 'service_role');
