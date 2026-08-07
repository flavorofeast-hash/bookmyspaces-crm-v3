-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 035: Loyalty Foundation
-- File  : 035_loyalty_foundation.sql
-- Runs  : AFTER 012_v3_foundation_schema.sql (loyalty_transactions.reference_id
--         may point at a reservation)
--
-- PURPOSE (Growth Engine Epic 3 — Loyalty Foundation):
-- No loyalty/points/tier concept exists anywhere in this codebase (confirmed
-- by a full grep before writing this migration). This adds the FOUNDATION
-- only — a points ledger, a cached balance/tier per lead, and a seedable
-- tier-rules table — not a full redemption/spend workflow, since what
-- points can actually be redeemed FOR is a business decision this migration
-- does not make. "Design for future expansion" per instruction: the ledger
-- (loyalty_transactions) is the source of truth, so redemption can be added
-- later as just another transaction type (negative points_delta) without a
-- schema change.
--
-- SCOPE: three new, standalone tables. Purely additive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS loyalty_tier_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier_name TEXT NOT NULL UNIQUE,
  min_points INTEGER NOT NULL DEFAULT 0,
  benefits_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO loyalty_tier_rules (tier_name, min_points, benefits_text, sort_order) VALUES
  ('Bronze', 0,    'Welcome tier — every guest starts here.', 0),
  ('Silver', 500,  'Early access to festival offers.', 1),
  ('Gold',   2000, 'Priority booking support + early access to festival offers.', 2),
  ('VIP',    5000, 'Priority booking support, complimentary upgrades subject to availability.', 3)
ON CONFLICT (tier_name) DO NOTHING;

COMMENT ON TABLE loyalty_tier_rules IS
  'Seedable tier thresholds (Growth Engine Epic 3). Default thresholds/benefits text are a reasonable starting point, not a business decision locked in — edit rows directly to change them.';

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  lead_id UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  points_balance INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'Bronze'
);

ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON loyalty_accounts;
CREATE POLICY "Service role full access" ON loyalty_accounts
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE loyalty_accounts IS
  'Cached points balance + tier per lead (Growth Engine Epic 3). points_balance is a cache of SUM(loyalty_transactions.points_delta) for that lead, maintained by application code (src/lib/customers/loyalty.ts) on every transaction insert — loyalty_transactions remains the source of truth.';

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  points_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT, -- e.g. 'reservation', 'manual', 'redemption'
  reference_id UUID
);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_lead ON loyalty_transactions(lead_id, created_at DESC);
-- Prevents double-awarding points for the same reservation if a sync job
-- runs twice — application code checks this before inserting, but the
-- partial unique index makes it enforced at the DB level too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_transactions_reservation_award
  ON loyalty_transactions(reference_id)
  WHERE reference_type = 'reservation';

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON loyalty_transactions;
CREATE POLICY "Service role full access" ON loyalty_transactions
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE loyalty_transactions IS
  'Append-only points ledger (Growth Engine Epic 3) — source of truth for loyalty_accounts.points_balance. Positive points_delta = earned, negative = redeemed/adjusted down.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'loyalty_%';
-- Expect 3 rows. SELECT * FROM loyalty_tier_rules ORDER BY sort_order; expect 4 seeded rows.
-- ─────────────────────────────────────────────────────────────────────────────
