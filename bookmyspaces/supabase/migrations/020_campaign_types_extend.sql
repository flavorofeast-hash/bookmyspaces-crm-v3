-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 020 — extend broadcast_campaigns.type CHECK constraint.
--
-- BUG FIX, found during this same Revenue Intelligence audit pass: an
-- earlier change this session (Marketing Automation — Birthday/Anniversary/
-- Dormant segments) added 'birthday', 'anniversary', 'dormant' as
-- selectable campaign types in src/app/(crm)/campaigns/page.tsx, but never
-- checked the DB-level CHECK constraint on broadcast_campaigns.type
-- (migration 004), which only allows 'festival' | 'followup' |
-- 'reengagement' | 'offer' | 'review_request' | 'custom'. Without this
-- migration, creating a Birthday/Anniversary/Dormant campaign from that UI
-- would fail with a constraint violation the moment migration 004's
-- constraint is enforced. Caught here, before it reached anyone.
--
-- Additive and idempotent; ROLLBACK file alongside.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'broadcast_campaigns_type_check'
  ) THEN
    ALTER TABLE broadcast_campaigns DROP CONSTRAINT broadcast_campaigns_type_check;
  END IF;

  ALTER TABLE broadcast_campaigns
    ADD CONSTRAINT broadcast_campaigns_type_check
    CHECK (type IN (
      'festival', 'followup', 'reengagement', 'offer', 'review_request',
      'birthday', 'anniversary', 'dormant', 'custom'
    ));
END $$;
