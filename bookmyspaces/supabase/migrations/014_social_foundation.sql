-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 014 — Social Media Command Center foundation (V3 Phase 5)
--
-- Additive only. Four tables: social_accounts (connected platform accounts),
-- social_interactions (comments/mentions/reviews/story+post replies — the
-- Unified Social Inbox read model), social_posts (content studio/scheduler),
-- reviews (aggregated review management). Social DMs do NOT live here — they
-- flow through the existing unified conversation platform (migration 012)
-- via channel adapters, same as WhatsApp/website chat.
--
-- Same conventions as 012: uuid PKs, update_updated_at_column trigger,
-- RLS service_role-only (all access via server routes with requireAuth).
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- Rollback: 014_social_foundation_ROLLBACK.sql.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  platform TEXT NOT NULL CHECK (platform IN (
    'facebook', 'instagram', 'linkedin', 'google_business', 'x', 'youtube', 'threads'
  )),
  display_name TEXT NOT NULL,
  external_account_id TEXT,            -- page id / ig business id / channel id
  -- Access tokens are stored encrypted by the application layer (never
  -- plaintext, never logged). NULL until the account is actually connected.
  access_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] DEFAULT '{}',
  config JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN (
    'disconnected', 'connected', 'token_expired', 'error'
  )),
  is_active BOOLEAN DEFAULT TRUE,

  UNIQUE(platform, external_account_id)
);

DROP TRIGGER IF EXISTS update_social_accounts_updated_at ON social_accounts;
CREATE TRIGGER update_social_accounts_updated_at
  BEFORE UPDATE ON social_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_accounts_service_role_all" ON social_accounts;
CREATE POLICY "social_accounts_service_role_all" ON social_accounts
  FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS social_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'comment', 'mention', 'review', 'story_reply', 'post_reply'
  )),
  external_id TEXT,                    -- platform-native id (idempotency key)
  external_parent_id TEXT,             -- post/media the interaction belongs to
  author_name TEXT,
  author_external_id TEXT,
  content TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative') OR sentiment IS NULL),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'escalated', 'archived')),
  reply_draft TEXT,                    -- AI-drafted reply awaiting human approval
  replied_at TIMESTAMPTZ,
  customer_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES unified_conversations(id) ON DELETE SET NULL,
  raw_payload JSONB,

  UNIQUE(platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_interactions_status ON social_interactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_interactions_platform ON social_interactions(platform);
CREATE INDEX IF NOT EXISTS idx_social_interactions_customer_id ON social_interactions(customer_id);

ALTER TABLE social_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_interactions_service_role_all" ON social_interactions;
CREATE POLICY "social_interactions_service_role_all" ON social_interactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  post_type TEXT NOT NULL DEFAULT 'text' CHECK (post_type IN (
    'text', 'image', 'carousel', 'video', 'reel', 'story'
  )),
  content TEXT,
  media JSONB DEFAULT '[]',            -- [{url, type, alt}] — storage refs
  hashtags TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'approved', 'scheduled', 'publishing', 'published', 'failed'
  )),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  external_post_id TEXT,
  failure_reason TEXT,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_social_posts_status_scheduled ON social_posts(status, scheduled_at);

DROP TRIGGER IF EXISTS update_social_posts_updated_at ON social_posts;
CREATE TRIGGER update_social_posts_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_posts_service_role_all" ON social_posts;
CREATE POLICY "social_posts_service_role_all" ON social_posts
  FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  platform TEXT NOT NULL CHECK (platform IN ('google', 'facebook', 'booking', 'other')),
  external_id TEXT,
  author_name TEXT,
  rating NUMERIC(2,1) CHECK (rating >= 0 AND rating <= 5),
  content TEXT,
  review_date TIMESTAMPTZ,
  response_draft TEXT,                 -- AI-drafted, human-approved before posting
  response_status TEXT NOT NULL DEFAULT 'none' CHECK (response_status IN (
    'none', 'drafted', 'approved', 'posted'
  )),
  responded_at TIMESTAMPTZ,
  customer_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  raw_payload JSONB,

  UNIQUE(platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_platform_date ON reviews(platform, review_date DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_response_status ON reviews(response_status);

DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_service_role_all" ON reviews;
CREATE POLICY "reviews_service_role_all" ON reviews
  FOR ALL USING (auth.role() = 'service_role');
