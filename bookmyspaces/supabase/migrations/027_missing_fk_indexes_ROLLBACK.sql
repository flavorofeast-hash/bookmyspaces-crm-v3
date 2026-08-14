-- ROLLBACK for 027_missing_fk_indexes.sql
-- Drops all 14 indexes added by the forward migration. Safe: none of these
-- indexes are unique/constraint-backing, so dropping them cannot affect
-- data integrity — only query performance reverts to pre-027 levels.
-- (idx_message_queue_lead_id, idx_blocked_dates_booking_id,
-- idx_orchestration_decisions_message_id, and
-- idx_escalations_conversation_id were removed from the forward
-- migration — message_queue, blocked_dates, and orchestration_decisions
-- do not exist in production, and escalations.conversation_id does not
-- exist on the live escalations table — so none are listed here either.)

BEGIN;

DROP INDEX IF EXISTS idx_bookings_lead_id;
DROP INDEX IF EXISTS idx_bookings_proposal_id;
DROP INDEX IF EXISTS idx_leads_imported_via_import_id;
DROP INDEX IF EXISTS idx_unified_conversations_first_touch_channel_id;
DROP INDEX IF EXISTS idx_reservations_meal_plan_id;
DROP INDEX IF EXISTS idx_reservations_proposal_id;
DROP INDEX IF EXISTS idx_reservations_invoice_id;
DROP INDEX IF EXISTS idx_reservation_addons_addon_service_id;
DROP INDEX IF EXISTS idx_proposals_inventory_item_id;
DROP INDEX IF EXISTS idx_social_interactions_account_id;
DROP INDEX IF EXISTS idx_social_interactions_conversation_id;
DROP INDEX IF EXISTS idx_social_posts_account_id;
DROP INDEX IF EXISTS idx_reviews_customer_id;
DROP INDEX IF EXISTS idx_packages_meal_plan_id;

COMMIT;
