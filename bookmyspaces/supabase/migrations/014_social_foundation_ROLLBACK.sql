-- ROLLBACK for migration 014 — Social Media Command Center foundation.
-- Destroys the four social tables and their data. Only run if 014 must be
-- fully reverted; there are no FKs from other tables into these.
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS social_posts;
DROP TABLE IF EXISTS social_interactions;
DROP TABLE IF EXISTS social_accounts;
