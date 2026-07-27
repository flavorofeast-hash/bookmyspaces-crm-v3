-- ROLLBACK for 024_event_sales_expansion.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_interaction_log_interaction_type_check') THEN
    ALTER TABLE ai_interaction_log DROP CONSTRAINT ai_interaction_log_interaction_type_check;
  END IF;

  ALTER TABLE ai_interaction_log
    ADD CONSTRAINT ai_interaction_log_interaction_type_check
    CHECK (interaction_type IN (
      'customer_summary', 'conversation_summary', 'suggested_whatsapp_reply',
      'suggested_email', 'recommended_room', 'recommended_package', 'recommended_follow_up'
    ));
END $$;

DROP INDEX IF EXISTS idx_proposals_hall;
ALTER TABLE proposals DROP COLUMN IF EXISTS hall;

DROP INDEX IF EXISTS idx_packages_hall;
ALTER TABLE packages
  DROP COLUMN IF EXISTS hall,
  DROP COLUMN IF EXISTS seating_style,
  DROP COLUMN IF EXISTS addon_service_ids,
  DROP COLUMN IF EXISTS seasonal_pricing,
  DROP COLUMN IF EXISTS standard_discount_pct;
