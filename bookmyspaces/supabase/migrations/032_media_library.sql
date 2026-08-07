-- ═══════════════════════════════════════════════════════════════════════════
-- BOOKMYSPACES — MIGRATION 032: Media Library
-- File  : 032_media_library.sql
-- Runs  : AFTER 014_social_foundation.sql (social_posts.media JSONB already
--         accepts {url, type} entries — this table is a reusable INDEX of
--         media URLs, not a change to that shape)
--
-- PURPOSE (Growth Platform Phase 4 — Social Media Planner: Media Library):
-- social_posts.media already stores {url, type} per post, but there was no
-- way to reuse a previously-used image/video across multiple posts without
-- re-typing the URL — confirmed by a full grep of src/lib/social/* before
-- writing this migration; no media-reference table existed anywhere. This
-- adds exactly that: a flat, reusable library of media URLs the operator
-- has already hosted somewhere (this system does not host file uploads —
-- no storage integration is added here, consistent with "design the
-- architecture so integrations can be added later without redesign").
--
-- SCOPE: one new, standalone, purely additive table.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS media_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  label TEXT,
  tags TEXT[] DEFAULT '{}',

  created_by TEXT DEFAULT 'admin',
  use_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_library_tags ON media_library USING GIN (tags);

ALTER TABLE media_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON media_library;
CREATE POLICY "Service role full access" ON media_library
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE media_library IS
  'Reusable index of media URLs for social posts (Growth Platform Phase 4). Stores references only — this system does not host file uploads; operators paste a URL from wherever the asset already lives (e.g. property photos already hosted for the website).';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-FLIGHT: SELECT table_name FROM information_schema.tables WHERE table_name = 'media_library';
-- Expect 1 row.
-- ─────────────────────────────────────────────────────────────────────────────
