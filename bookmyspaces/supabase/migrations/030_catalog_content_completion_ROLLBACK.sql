-- ROLLBACK for 030_catalog_content_completion.sql

DROP INDEX IF EXISTS idx_packages_seo_slug;
DROP INDEX IF EXISTS idx_social_posts_campaign_id;
DROP INDEX IF EXISTS idx_social_posts_package_id;

ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check
  CHECK (status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed'));

ALTER TABLE social_posts
  DROP COLUMN IF EXISTS target_audience,
  DROP COLUMN IF EXISTS image_concept,
  DROP COLUMN IF EXISTS cta_text,
  DROP COLUMN IF EXISTS headline,
  DROP COLUMN IF EXISTS campaign_id,
  DROP COLUMN IF EXISTS package_id;

ALTER TABLE inventory_items
  DROP COLUMN IF EXISTS target_audience,
  DROP COLUMN IF EXISTS seo_slug,
  DROP COLUMN IF EXISTS seo_description,
  DROP COLUMN IF EXISTS seo_title,
  DROP COLUMN IF EXISTS whatsapp_cta_text,
  DROP COLUMN IF EXISTS booking_url,
  DROP COLUMN IF EXISTS images,
  DROP COLUMN IF EXISTS features;

ALTER TABLE packages
  DROP COLUMN IF EXISTS target_audience,
  DROP COLUMN IF EXISTS seo_slug,
  DROP COLUMN IF EXISTS seo_description,
  DROP COLUMN IF EXISTS seo_title,
  DROP COLUMN IF EXISTS whatsapp_cta_text,
  DROP COLUMN IF EXISTS booking_url,
  DROP COLUMN IF EXISTS exclusions,
  DROP COLUMN IF EXISTS price_unit;
