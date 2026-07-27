-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 022 — Win-back Automation (Customer Journey Automation).
--
-- WHY A SEED ROW, NOT NEW CODE: per "reuse, don't redesign," win-back is
-- already fully supported by existing infrastructure —
--   - buildSegment()'s dormant_since_days filter (src/lib/campaigns.ts)
--   - scheduleCampaignSend() / advanceRecurringCampaigns() (Priority 3
--     Campaign Scheduler, src/lib/campaign-scheduler.ts)
--   - the hourly /api/cron/campaign-queue drain, already registered in
--     vercel.json
-- The only missing piece was that this machinery is entirely operator-
-- triggered — nothing ever creates a win-back campaign automatically.
-- This migration seeds exactly one system-owned recurring campaign row;
-- from that point on, the existing recurring-campaign machinery drives it
-- unattended (re-evaluates the dormant segment fresh and re-sends weekly).
-- An operator can still see, edit, pause, or cancel it from the Campaigns
-- UI like any other campaign — no new UI needed.
--
-- Idempotent: guarded on notes = 'SYSTEM_WINBACK_AUTOMATION' so re-running
-- this migration (or restoring from an environment where it already ran)
-- never creates a duplicate.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM broadcast_campaigns WHERE notes = 'SYSTEM_WINBACK_AUTOMATION'
  ) THEN
    INSERT INTO broadcast_campaigns (
      name, type, segment, message_template, template_name,
      recipient_count, status, is_recurring, recurrence_interval, next_run_at,
      created_by, notes
    ) VALUES (
      'Win-back Automation (System)',
      'dormant',
      '{"dormant_since_days": 60}'::jsonb,
      $msg$Hi {{name}}! It's been a while since we last connected at *BookMySpaces* 🌟

We've added new packages and offers since your last visit — we'd love to host you again!

Reply here or call us to check availability for your next celebration or stay. 🎉

📞 9051459463 | 🌐 www.bookmyspaces.in$msg$,
      'system_winback',
      0,
      'draft',
      TRUE,
      'weekly',
      NOW(),
      'system',
      'SYSTEM_WINBACK_AUTOMATION'
    );
  END IF;
END $$;
