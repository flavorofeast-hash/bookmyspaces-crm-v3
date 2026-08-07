-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 034: Referral Engine (codes + rewards foundation)
-- File  : 034_referral_engine.sql
-- Runs  : AFTER 026_campaign_landing_attribution.sql (leads.referral already
--         captures free-text referral source, written by POST /api/campaigns/
--         track from the `?ref=`/`?referral=` query param on any landing page)
--
-- PURPOSE (Growth Engine Epic 2 — Referral Engine):
-- `computeReferralPerformance()` (src/lib/customers/referrals.ts) already
-- attributes referrals by matching a phone number inside `leads.referral`
-- free text — real, but asks customers to share their own phone number as
-- an ad-hoc "code", with no dedicated link, no click tracking, and no
-- reward concept. This migration adds the missing pieces as NEW, additive
-- tables — it does not touch `leads.referral` or the existing phone-match
-- logic, which remains a supported fallback (backward compatible, per
-- instruction).
--
-- SCOPE: two new, standalone tables. Purely additive.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,

  click_count INTEGER DEFAULT 0,
  signup_count INTEGER DEFAULT 0,

  UNIQUE(lead_id)
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON referral_codes;
CREATE POLICY "Service role full access" ON referral_codes
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE referral_codes IS
  'One short, shareable referral code per lead (Growth Engine Epic 2). Referral links are built as <landing-page-url>?ref=<code>, reusing the existing POST /api/campaigns/track capture path unchanged — leads.referral stores the code as free text exactly as it already stores phone numbers, so computeReferralPerformance() can match on either.';

CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  referrer_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  referred_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'earned', 'redeemed', 'cancelled')),
  reward_type TEXT DEFAULT 'unspecified', -- e.g. 'discount_pct', 'flat_credit' — operator-defined, not enforced
  reward_value NUMERIC,
  notes TEXT,

  UNIQUE(referrer_lead_id, referred_lead_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON referral_rewards;
CREATE POLICY "Service role full access" ON referral_rewards
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE referral_rewards IS
  'Referral reward FOUNDATION (Growth Engine Epic 2) — tracks that a referral earned a reward and its status, but does not define what the reward actually is or automate payout/redemption (a business decision this migration does not make). reward_type/reward_value are free-form for an operator to fill in manually.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT:
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('referral_codes', 'referral_rewards');
-- Expect 2 rows.
-- ─────────────────────────────────────────────────────────────────────────────
