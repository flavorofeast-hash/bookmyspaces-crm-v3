-- ─────────────────────────────────────────────────────────────────────────────
-- FILE: supabase/migrations/025_orchestration_observability.sql
-- Phase 1B, Step 2 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
-- audit/PHASE_1B_STEP2_READINESS_REVIEW.md). Schema only -- no application
-- code reads or writes anything in this migration as of this step. The
-- Phase 1B orchestration feature flag (settings.orchestration.enabled,
-- Step 1) is unaffected and remains false; nothing in this migration
-- consults it.
--
-- WHAT THIS DOES, AND WHY (see the Step 2 Readiness Review for the full
-- investigation this is based on):
--
--   1. A partial UNIQUE index on unified_messages(channel_id,
--      external_message_id) -- gives inbound-guard.ts's isDuplicateDelivery
--      check a real, enforceable backing store for the first time. Today
--      unified_messages only has a plain, non-unique index on
--      external_message_id alone (idx_unified_messages_external_id,
--      migration 012) -- a lookup-speed index, not a correctness
--      constraint. Partial (WHERE external_message_id IS NOT NULL) so
--      messages with no channel-native id (most non-webhook-originated
--      rows today) are never affected -- confirmed against the current
--      12-column unified_messages shape before writing this.
--
--      Traced (Step 2 Readiness Review, Section 11) whether any existing
--      caller could ever legitimately double-insert the same
--      (channel_id, external_message_id) pair: no retry logic exists in
--      the one live caller of this write path
--      (syncToUnifiedConversationPlatform() -> handleInboundMessage() ->
--      recordMessage(), in the WhatsApp webhook route), and that call is
--      already fire-and-forget / non-fatal at the webhook. A genuine Meta
--      webhook redelivery is the only realistic trigger, and this index
--      turns that from a silent duplicate row into one logged, rejected
--      insert -- a data-quality improvement, not a behavior change to any
--      customer-facing reply.
--
--      Locking: plain CREATE UNIQUE INDEX (no CONCURRENTLY) -- matches
--      this repo's own convention (no migration 001-024 uses
--      CONCURRENTLY, and it cannot run inside the same transactional
--      migration-file convention this repo already uses). Kept
--      practical rather than unnecessary: the partial WHERE clause
--      means only rows with a non-null external_message_id are scanned/
--      locked-against, and unified_messages is a new, low-write-volume
--      table (the Unified Conversation Platform mirror is the only
--      current writer) -- so the brief write-blocking window a plain
--      CREATE INDEX takes is negligible in practice today.
--
--   2. orchestration_decisions -- a new, standalone table for the Phase 1B
--      shadow/active-mode decision log (design doc Section 5.2). Not
--      read or written by any code as of this migration; Step 6 is the
--      first step that will insert into it. RLS enabled + a
--      service_role-only policy, matching every other table added in
--      migration 012 exactly (same "{table}_service_role_all" naming and
--      FOR ALL USING (auth.role() = 'service_role') shape).
--
-- Idempotent (IF NOT EXISTS throughout) -- safe to re-run, same convention
-- as every other migration in this repo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. unified_messages idempotency ─────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS unified_messages_channel_external_id_uq
  ON unified_messages (channel_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- ── 2. orchestration_decisions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orchestration_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  conversation_id UUID REFERENCES unified_conversations(id),
  message_id UUID REFERENCES unified_messages(id),

  -- 'shadow': computed and logged only, nothing executed (Steps 6-7 default).
  -- 'active': the Executor (a later Phase 1B step) actually acted on this decision.
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'active')),

  -- One of decision-table.ts's OrchestrationAction values, and its one-line
  -- reason string -- both copied verbatim from orchestrate()'s DecisionResult,
  -- not re-derived here.
  action TEXT NOT NULL,
  reason TEXT NOT NULL,

  -- slot-memory.ts's Critical Issue 1 conflict output finally has somewhere
  -- to land -- previously computed by mergeSlots() every turn but never
  -- persisted anywhere. had_conflicts is a denormalized convenience column
  -- for cheap filtering; conflicts carries the full SlotConflict[] verbatim.
  had_conflicts BOOLEAN NOT NULL DEFAULT false,
  conflicts JSONB,

  -- False for every shadow-mode row by definition; set true only once a
  -- later step's Executor actually invokes the mapped tool.
  executed BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_orchestration_decisions_conversation_id ON orchestration_decisions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_orchestration_decisions_created_at ON orchestration_decisions(created_at DESC);

ALTER TABLE orchestration_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orchestration_decisions_service_role_all" ON orchestration_decisions;
CREATE POLICY "orchestration_decisions_service_role_all" ON orchestration_decisions
  FOR ALL USING (auth.role() = 'service_role');
