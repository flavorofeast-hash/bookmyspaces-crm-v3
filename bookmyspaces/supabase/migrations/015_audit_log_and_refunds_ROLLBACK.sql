-- ROLLBACK for migration 015.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check_v15;
DROP TABLE IF EXISTS admin_audit_log;
