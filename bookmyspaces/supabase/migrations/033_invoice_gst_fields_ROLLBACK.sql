-- ROLLBACK for 033_invoice_gst_fields.sql
-- Drops the GST snapshot columns added to `invoices`. Destructive: any
-- GST/NON_GST tax-mode data recorded on real invoices is lost. Only run
-- this if migration 033 needs to be fully reverted.

BEGIN;

ALTER TABLE invoices
  DROP COLUMN IF EXISTS tax_mode,
  DROP COLUMN IF EXISTS is_interstate,
  DROP COLUMN IF EXISTS gst_rate_percent,
  DROP COLUMN IF EXISTS gstin,
  DROP COLUMN IF EXISTS cgst_amount,
  DROP COLUMN IF EXISTS sgst_amount,
  DROP COLUMN IF EXISTS igst_amount;

COMMIT;
