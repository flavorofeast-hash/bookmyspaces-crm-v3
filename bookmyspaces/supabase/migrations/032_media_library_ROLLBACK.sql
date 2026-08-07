-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 032_media_library.sql — drops media_library and its data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS media_library;

COMMIT;
