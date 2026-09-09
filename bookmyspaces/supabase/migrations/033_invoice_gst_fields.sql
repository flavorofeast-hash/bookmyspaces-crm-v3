-- ═══════════════════════════════════════════════════════════
-- BOOKMYSPACES — 033 INVOICE GST FIELDS
--
-- Adds GST snapshot columns to `invoices` (migration 009) so the final
-- billing invoice can record a tax mode (GST / NON_GST) at the moment it is
-- first generated, and never have that snapshot change afterward even if
-- the configured GST rate changes later -- same "computed once, at
-- creation" pattern this table already uses for tax_amount/invoice_number
-- (see src/app/api/proposals/[id]/invoice/route.ts).
--
-- Advance payments (`payments` table, migration 009) are untouched by this
-- migration and remain GST-free by construction -- there is no GST column
-- on `payments` because an advance receipt must never show one.
--
-- document_type is deliberately NOT added as a column anywhere: which table
-- a row lives in already encodes it unambiguously (`payments` = an advance
-- record, `invoices` = the final billing invoice), so a redundant enum
-- column would just be duplicate bookkeeping of something the schema
-- already expresses structurally.
--
-- Backfill: all invoices generated before this migration were created with
-- no GST concept at all (tax_amount was always 0 in this environment, see
-- src/lib/tax.ts's prior inclusive-split model) -- backfilling their
-- tax_mode to 'NON_GST' records that historical fact accurately, not a
-- guess. No other historical invoice field is touched.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS), transactional, safe to re-run.
-- ═══════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tax_mode         TEXT CHECK (tax_mode IN ('GST', 'NON_GST')),
  ADD COLUMN IF NOT EXISTS is_interstate    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_rate_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS gstin            TEXT,
  ADD COLUMN IF NOT EXISTS cgst_amount      NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount      NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount      NUMERIC NOT NULL DEFAULT 0;

-- Historical backfill -- see header. Only touches rows that predate this
-- migration (tax_mode IS NULL); never re-runs against an invoice that
-- already has a real tax_mode snapshot.
UPDATE invoices SET tax_mode = 'NON_GST' WHERE tax_mode IS NULL;

COMMIT;
