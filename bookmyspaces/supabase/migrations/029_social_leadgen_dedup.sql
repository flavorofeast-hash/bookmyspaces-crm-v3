-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 029 — Facebook/Instagram Lead Ads webhook idempotency
--
-- Meta integration hardening pass. POST /api/social/webhook/[platform]
-- processes a `leadgen` webhook event by fetching the form answers
-- (fetchLeadgenDetails) and calling captureLeadWithJourney() — with no
-- record of which leadgen_id had already been processed. Meta redelivers a
-- webhook on any non-2xx response or timeout, and (as flagged in this
-- session's SECURITY_AUDIT_REPORT.md, finding M9) a captured valid payload
-- can be replayed — every replay re-fetched the same Graph API data (extra
-- quota use) and re-ran captureLeadWithJourney(), which for a leadgen
-- submission with no phone/email inserted a fresh duplicate `leads` row on
-- every single replay, and for one that did match an existing lead re-ran
-- AI qualification/package-recommendation on every replay.
--
-- Additive only. Same conventions as migration 014 (social_interactions):
-- uuid PK, UNIQUE(leadgen_id) as the actual idempotency guarantee (belt-
-- and-suspenders alongside the application-level check-before-process the
-- code now also does), RLS service_role-only. Idempotent: IF NOT EXISTS /
-- DROP POLICY IF EXISTS throughout, safe to run more than once.
-- Rollback: 029_social_leadgen_dedup_ROLLBACK.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS social_leadgen_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  leadgen_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  -- Best-effort link to the lead this event produced/matched — nullable
  -- because fetchLeadgenDetails() can fail (Graph error) or return no
  -- phone/email, in which case no lead is created and this stays NULL; the
  -- event is still recorded as processed either way, so a subsequent Graph
  -- outage doesn't cause the same leadgen_id to be retried forever.
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  UNIQUE(leadgen_id)
);

CREATE INDEX IF NOT EXISTS idx_social_leadgen_events_leadgen_id ON social_leadgen_events(leadgen_id);

ALTER TABLE social_leadgen_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_leadgen_events_service_role_all" ON social_leadgen_events;
CREATE POLICY "social_leadgen_events_service_role_all" ON social_leadgen_events
  FOR ALL USING (auth.role() = 'service_role');
