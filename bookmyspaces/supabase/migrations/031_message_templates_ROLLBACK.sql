-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 031_message_templates.sql — drops message_templates and its data.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS message_templates;

COMMIT;
