-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 041: social_posts.approved_at
-- File  : 041_social_post_approved_at.sql
-- Runs  : AFTER 040_social_connectivity_and_attribution.sql
--
-- PURPOSE:
--   Content Operations Priority 5 — approval hard gate bug fix. The gate
--   (publish-service.ts) originally only checked status='draft', which let
--   the approval requirement be trivially bypassed by scheduling a post
--   (status auto-becomes 'scheduled' at creation) instead of publishing it
--   directly — a scheduled post published via cron with zero human review,
--   defeating the feature's own purpose.
--
--   Extending the gate to also cover 'scheduled' surfaced a second,
--   pre-existing issue: the PATCH .../posts 'approve' action flips status
--   straight to 'approved', which removes the row from
--   processDueScheduledPosts()'s status='scheduled' selection — approving a
--   scheduled post silently stopped it from ever auto-publishing at its
--   scheduled time, cron-eligibility-breaking behavior that predates this
--   migration and would otherwise now be hit far more often once approval
--   is required.
--
--   Fix: approved_at lets a 'scheduled' post record "a human approved this"
--   WITHOUT leaving status='scheduled' — cron continues to find and publish
--   it normally at scheduled_at, and publish-service.ts's gate now checks
--   this column instead of requiring an incompatible status change. Draft
--   posts are unaffected — approving a draft still simply sets
--   status='approved', exactly as before.
--
-- SCOPE: one nullable column added to one existing table. Purely additive —
-- no existing row touched (defaults to NULL, meaning "not yet approved",
-- which is the correct/safe value for every row that already exists).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMENT ON COLUMN social_posts.approved_at IS
  'Set when a human approves a status=scheduled post under the publish-config.ts approval gate, WITHOUT changing status away from scheduled (so it remains cron-eligible). NULL = not yet approved (default/current state of every existing row). Draft posts do not use this column — approving a draft still transitions status directly to approved.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'social_posts' AND column_name = 'approved_at';
-- Expect 1 row.
-- ─────────────────────────────────────────────────────────────────────────────
