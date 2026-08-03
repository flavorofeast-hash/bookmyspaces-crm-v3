-- ROLLBACK for migration 029.
--
-- Drops reservations.package_name and reservations.venue.
--
-- WARNING: application code (src/lib/reservations/commercial-source.ts,
-- src/lib/reservations/reservation-workflow.ts, src/lib/reservations/
-- reservation-service.ts) reads/writes these columns once migration 029 is
-- applied. Roll back the application code (or redeploy the pre-029 version)
-- BEFORE running this, or those code paths will start erroring on the
-- missing columns.

BEGIN;

ALTER TABLE reservations
  DROP COLUMN IF EXISTS package_name,
  DROP COLUMN IF EXISTS venue;

COMMIT;
