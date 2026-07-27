-- ROLLBACK for 023_event_package_management.sql

DROP INDEX IF EXISTS idx_proposals_package_id;
ALTER TABLE proposals DROP COLUMN IF EXISTS package_id;

DROP INDEX IF EXISTS idx_packages_event_types;
ALTER TABLE packages
  DROP COLUMN IF EXISTS event_types,
  DROP COLUMN IF EXISTS images,
  DROP COLUMN IF EXISTS room_inventory_item_ids,
  DROP COLUMN IF EXISTS meal_plan_id,
  DROP COLUMN IF EXISTS tax_rate_override_pct;
