-- MIGRATION 032 — add 'property' to media_assets.venue_tag, for Skyline
-- Serenity's general property photography (not tied to a specific room).
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_venue_tag_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_venue_tag_check
  CHECK (venue_tag IN ('rooftop', 'cafe', 'rooms', 'hall', 'private_dining', 'property', 'general'));
