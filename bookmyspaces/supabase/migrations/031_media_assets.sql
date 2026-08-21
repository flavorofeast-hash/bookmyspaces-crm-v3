-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 031 — Media asset library.
--
-- WHY THIS IS NEEDED: audit confirmed no media/asset storage exists anywhere
-- in this app -- `packages.images`/`inventory_items.images` (migration 030)
-- are flat TEXT[] URL lists with nowhere to attach a tag to an individual
-- image (property, venue, asset type, human-vs-AI source). Real per-asset
-- tagging, requested for the marketing-asset import, requires a real table.
-- This is the one clearly-missing piece the catalog/content system needs to
-- support a real media library -- everything else (packages, inventory_items,
-- social_posts, Content Studio) is unchanged by this migration.
--
-- Same RLS convention as social_posts/packages: service-role only. All
-- reads/writes go through requireAuth()-gated API routes using the
-- service-role client, never direct client-side Supabase queries -- matches
-- every other table in this app (confirmed via social_posts' own policy).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  original_filename TEXT,

  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  venue_tag TEXT CHECK (venue_tag IN ('rooftop', 'cafe', 'rooms', 'hall', 'private_dining', 'general')),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('property_photo', 'creative', 'advertisement', 'hero_image')),
  source TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human', 'ai')),

  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,

  width INTEGER,
  height INTEGER,

  UNIQUE (file_hash)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_property_id ON media_assets(property_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_venue_tag ON media_assets(venue_tag);
CREATE INDEX IF NOT EXISTS idx_media_assets_asset_type ON media_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_media_assets_source ON media_assets(source);

DROP TRIGGER IF EXISTS update_media_assets_updated_at ON media_assets;
CREATE TRIGGER update_media_assets_updated_at
  BEFORE UPDATE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "media_assets_service_role_all" ON media_assets;
CREATE POLICY "media_assets_service_role_all" ON media_assets
  FOR ALL USING (auth.role() = 'service_role');

-- Storage bucket for the actual files. Public so image URLs work directly
-- in social post previews/publishing without a signed-URL round trip --
-- same posture as every image already referenced in this app (packages/
-- inventory_items images are plain external URLs, publicly readable).
INSERT INTO storage.buckets (id, name, public)
VALUES ('media-assets', 'media-assets', true)
ON CONFLICT (id) DO NOTHING;
