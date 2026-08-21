-- ROLLBACK for 031_media_assets.sql
-- Note: does not delete uploaded Storage objects, only the bucket record
-- and the tracking table. Remove objects via the Storage dashboard first
-- if actually rolling back a real import.

DELETE FROM storage.buckets WHERE id = 'media-assets';
DROP TABLE IF EXISTS media_assets;
