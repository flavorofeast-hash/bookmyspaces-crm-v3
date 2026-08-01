-- scripts/verify-notifications-columns.sql
-- Version 3.0 (AI Chief of Staff) — read-only, information_schema-only.
-- Safe to run against production any number of times.
--
-- notification-producer.ts (src/lib/chief-of-staff/notification-producer.ts)
-- is the FIRST-EVER writer of the `notifications` table anywhere in this
-- codebase. The table is a confirmed-live, undocumented production object
-- (not defined in any migration file — see audit/DATABASE_RECONCILIATION.md
-- / audit/LIVE_SCHEMA_AUDIT.md). Only five columns are confirmed by reading
-- actual code that already reads/writes it: user_id, is_read, dismissed_at,
-- read_at, created_at, priority. notification-producer.ts additionally
-- writes `title`/`message` — a reasonable but UNVERIFIED assumption. Run
-- this before relying on the Chief of Staff's notification writes in
-- production; if `title`/`message` (or their real equivalents) are missing,
-- every insert will fail (logged, non-fatal to the brief itself, but no
-- notifications will actually be written).

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'notifications'
ORDER BY ordinal_position;

-- Expected (confirmed by code): user_id, is_read, dismissed_at, read_at,
-- created_at, priority.
-- Expected (assumed by notification-producer.ts, verify here): title,
-- message.
-- If title/message are absent, check this result for the real content
-- column names and update notification-producer.ts's insert accordingly.
