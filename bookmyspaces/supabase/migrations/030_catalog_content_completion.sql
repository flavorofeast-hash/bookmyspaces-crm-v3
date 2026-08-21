-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION 030 — Catalog completion + Content Studio catalog linkage.
--
-- WHY EXTEND, NOT BUILD NEW: audit confirmed `packages` (event packages),
-- `inventory_items` (rooms/venues/event spaces), `meal_plans` (food) and
-- `addon_services` already form the real catalog, same reuse-over-duplicate
-- pattern migrations 023/024 already established for `packages`. This adds
-- only the fields those tables are genuinely missing for the Catalog →
-- Content → Social → Attribution build: marketing/SEO fields, and a real
-- FK from `social_posts` back to the catalog item and campaign it promotes.
--
-- Scope: `packages` and `inventory_items` (the two catalog entities Content
-- Studio and campaigns actually promote). `meal_plans`/`addon_services` are
-- reference data used inside a package, not independently marketed --
-- left alone; can extend later the same way if that changes.
--
-- Additive and idempotent; ROLLBACK file alongside.
-- ─────────────────────────────────────────────────────────────────────────────

-- packages: marketing/SEO/CTA fields Content Studio and campaigns need to
-- promote a package without re-deriving them ad hoc each time.
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS price_unit TEXT DEFAULT 'per_event' CHECK (price_unit IN ('per_event', 'per_person', 'per_hour', 'per_night')),
  ADD COLUMN IF NOT EXISTS exclusions TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_cta_text TEXT,
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS seo_slug TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT '{}';

-- inventory_items (rooms/venues/event spaces): same marketing fields, plus
-- `features`/`images` which this table never had (packages already has
-- `images` from migration 023; inventory_items didn't).
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS features TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_cta_text TEXT,
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS seo_slug TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT '{}';

-- social_posts: link content back to the catalog item and campaign it
-- promotes (Phase 4/5 attribution needs a real FK here, not a free-text
-- label), structured fields matching what AI content generation actually
-- produces (headline/CTA/image concept/target audience, separate from the
-- freeform `content` caption field), and 'review' added to the status
-- machine between draft and approved.
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES broadcast_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS cta_text TEXT,
  ADD COLUMN IF NOT EXISTS image_concept TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT '{}';

ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('draft', 'review', 'approved', 'scheduled', 'publishing', 'published', 'failed'));

CREATE INDEX IF NOT EXISTS idx_social_posts_package_id ON social_posts(package_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_campaign_id ON social_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_packages_seo_slug ON packages(seo_slug) WHERE seo_slug IS NOT NULL;
