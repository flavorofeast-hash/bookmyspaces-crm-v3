-- ROLLBACK for migration 027.
ALTER TABLE follow_ups
  DROP COLUMN IF EXISTS property,
  DROP COLUMN IF EXISTS purpose,
  DROP COLUMN IF EXISTS guest_count,
  DROP COLUMN IF EXISTS budget;

DROP INDEX IF EXISTS idx_follow_ups_type_scheduled_at;
