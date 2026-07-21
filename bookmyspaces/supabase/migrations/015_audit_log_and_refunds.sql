-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 015 — admin audit log + refund workflow (V3, VERSION1_1 Tier 1
-- items #2 and #4). Additive and idempotent; ROLLBACK file alongside.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Dedicated, queryable audit table for admin/privileged actions (RC1
--    recommendation: structured app logs exist but aren't queryable).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  actor TEXT NOT NULL,                  -- user email/id from requireRole()
  action TEXT NOT NULL,                 -- e.g. 'catalog.create', 'settings.update', 'payment.refund'
  entity_type TEXT,                     -- e.g. 'rate_plans', 'settings', 'payments'
  entity_id TEXT,
  detail JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_audit_log_service_role_all" ON admin_audit_log;
CREATE POLICY "admin_audit_log_service_role_all" ON admin_audit_log
  FOR ALL USING (auth.role() = 'service_role');

-- 2. Refund workflow: payment_type gains a real constraint including
--    'refund'. NOT VALID: existing production rows (whose payment_type
--    values predate any constraint) are not re-checked — only new writes
--    are, which is exactly the safety this needs without a data audit
--    blocking the migration. Refund rows must carry a negative amount;
--    non-refund rows a positive one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_type_check_v15'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_payment_type_check_v15
      CHECK (
        (payment_type IN ('advance', 'partial', 'full', 'final', 'security_deposit') AND amount > 0)
        OR (payment_type = 'refund' AND amount < 0)
      ) NOT VALID;
  END IF;
END $$;
