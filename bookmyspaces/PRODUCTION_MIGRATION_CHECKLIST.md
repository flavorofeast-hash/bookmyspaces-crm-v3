# Production Migration Checklist — BookMySpaces CRM V3

Generated during the Release Candidate hardening pass. Covers all 24 migrations in `supabase/migrations/`, in apply order, with what each one needs verified before/after running it against production.

## Current state

- **Assumed live in production:** migrations `001`–`011`. **Correction/caveat added after this checklist was first written:** this sandbox has never had network access to the production Supabase project (confirmed across every engineering session referenced in `audit/`, most recently `audit/ENGINEERING_WORKSPACE_CURRENT_STATE.md`), so "001-011 already live" is an inherited assumption, not something this pass independently verified against the live database. A prior session's `audit/VERSION1_RELEASE_READINESS_REPORT.md` (2026-07-15) found a specific, concrete exception worth treating as still-open until re-checked: **migration `004` (`broadcast_campaigns`, `festival_calendar` — backs the nav-linked Campaigns page) may never have been applied live**, which would mean every list/create/send action on `/campaigns` 500s in production today despite the code being fully correct. **Action required before go-live:** connect to the live database directly (`\dt` in `psql` or the Supabase Table Editor) and confirm `broadcast_campaigns` and `festival_calendar` actually exist before assuming the "001-011 live" baseline holds. If they don't, migration 004 needs to be applied alongside 012-024, not treated as already-done.
- **Pending / not yet applied to production:** migrations `012`–`024`. Every one of these is additive and fully idempotent — verified by grep across all 13 files: **zero** non-idempotent `CREATE TABLE`, `ADD COLUMN`, or `CREATE INDEX` statements. Every `CREATE TABLE` uses `IF NOT EXISTS`, every `ADD COLUMN` uses `IF NOT EXISTS`, every `CREATE INDEX` uses `IF NOT EXISTS`, and constraint changes use the `DROP CONSTRAINT IF EXISTS` → `ADD CONSTRAINT` pattern. They are safe to run in a single batch, in numeric order, and safe to re-run if a batch is interrupted partway. If migration 004 also turns out to be missing (see above), it's the same additive, safe-to-run-alongside-012-024 shape — no special handling needed beyond including it in the batch.

## Apply order and what each migration does

| # | File | Creates | Depends on | Notes |
|---|------|---------|------------|-------|
| 012 | `012_v3_foundation_schema.sql` | `properties`, `customer_identities`, `channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages`, `inventory_items`, `meal_plans`, `rate_plans`, `addon_services`, `reservations`, `reservation_addons`, `settings`, `ai_prompts`, `knowledge_sources`, `ai_interaction_log` (16 tables) | `leads` (001), `proposals` (003), `invoices` (009) | Largest migration (28KB). Internal table-creation order verified correct — every `REFERENCES` target is either created earlier in this same file or in an already-applied earlier migration. 16 `ENABLE ROW LEVEL SECURITY` statements for 16 tables (full coverage). Seeds 2 properties. |
| 013 | `013_proposal_reservation_links.sql` | — (alters `proposals`) | 012 | Adds `property_id`, `inventory_item_id`, `reservation_id`, `package_id`, `addon_service_ids` to `proposals`. Must run after 012 (references `properties`, `inventory_items`, `reservations`) and after 007 (references `packages`, already live). |
| 014 | `014_social_foundation.sql` | `social_accounts`, `social_interactions`, `social_posts`, `reviews` | — | Social Media Foundation. 4/4 RLS coverage. |
| 015 | `015_audit_log_and_refunds.sql` | `admin_audit_log` | — | Resolves a previously-open item ("no dedicated audit log table") — table exists and `src/lib/audit-log.ts` writes to it. **Currently only wired into `POST /api/leads/import`** — see Security Review for the coverage gap. |
| 016 | `016_leads_source_add_proposal.sql` | — (alters `leads.source` CHECK) | — | |
| 017 | `017_leads_source_add_excel_import.sql` | — (alters `leads.source` CHECK) | 016 | |
| 018 | `018_customer_bulk_import_fields.sql` | — (alters `leads`) | — | Adds bulk-import tracking columns. |
| 019 | `019_stage_transitions.sql` | `stage_transitions` | `leads` (001) | Powers Revenue Intelligence's "avg days in stage" metric — degrades to `null` (not a fake number) until this is live. |
| 020 | `020_campaign_types_extend.sql` | — (alters `broadcast_campaigns.type` CHECK) | 004 | **Fixes a real bug**: the Campaigns UI already offers `birthday`/`anniversary`/`dormant` campaign types that migration 004's original CHECK constraint rejects. Without this migration live, creating those campaign types fails at the DB layer. |
| 021 | `021_campaign_scheduler.sql` | — (alters `broadcast_campaigns`) | 004 | Adds `paused`/`cancelled` to the status CHECK, adds recurrence columns. |
| 022 | `022_winback_automation_seed.sql` | — (seeds one row) | 021 | Seeds the win-back recurring campaign. Must run after 021 (needs the recurrence columns to exist). |
| 023 | `023_event_package_management.sql` | — (alters `packages`, `proposals`) | 007 (packages), 013 (proposals.package_id already added — this migration's `ADD COLUMN IF NOT EXISTS package_id` is redundant-but-harmless if 013 already ran) | |
| 024 | `024_event_sales_expansion.sql` | — (alters `packages`, `proposals`, `ai_interaction_log`) | 012 (ai_interaction_log), 023 (packages fields) | **Fixes a real bug**: `ai_interaction_log.interaction_type` CHECK (set in 012) never included `'upsell_recommendations'` or `'event_sales_advisor'` — every write for those two AI actions has been silently failing since they shipped (swallowed by the app's fault-tolerant logging). This migration adds both values. |

## Structural verification performed

- **Ordering/dependencies:** every `REFERENCES` clause across all 24 files resolves to a table created in the same file (at an earlier line) or an earlier-numbered migration. No forward references, no circular dependencies.
- **Indexes:** every table with a foreign key or a commonly-filtered column (`status`, `created_at`, `lead_id`, etc.) has a matching `CREATE INDEX IF NOT EXISTS`.
- **RLS:** every table except `system_health_log` has `ENABLE ROW LEVEL SECURITY` plus a `service_role` policy. `system_health_log`'s omission is explicit and commented in migration 009 ("matches live") — low risk (no PII columns: service/event/duration/status_code/message/metadata) but recommended to close for defense-in-depth (see Security Review).
- **Defaults:** money columns default to `0` or are `NOT NULL` with no default (forcing explicit values), array columns default to `'{}'`, JSONB columns default to `'{}'` or `'[]'` consistently.
- **Idempotency:** confirmed via grep, see above — 0 violations across migrations 012–024.

## Pre-migration checklist

1. **Take a database backup / confirm Supabase's automatic backup is current** before running anything.
2. **Run migrations 012–024 in numeric order, in one sitting**, from a machine with real network access to the Supabase project (this sandbox environment does not have that access — confirmed across every session that has worked on this repo).
3. Use `npm run db:migrate:v3` (existing script, `scripts/apply-v3-migrations.mjs`) rather than pasting SQL by hand, so the script's own sequencing/error-handling is used.
4. After migrating, run `npm run db:smoke-test:v3` (`scripts/smoke-test-v3.mjs`).
5. Spot-check the two "fixes a real bug" migrations (020, 024) manually:
   - Create a test campaign with `type: 'birthday'` — should succeed (020).
   - Trigger the AI Event Sales Advisor from a customer detail page, then query `select * from ai_interaction_log where interaction_type = 'event_sales_advisor' order by created_at desc limit 1` — should return the row, not be empty (024).
6. Confirm `packages.addon_service_ids`, `packages.hall`, `packages.seasonal_pricing` exist (`\d packages` or the Supabase table editor) — these back the Smart Proposal Generator's package safe-fill.

## Rollback

Every migration 012–024 has a matching `_ROLLBACK.sql` file alongside it. Rollbacks are additive-reversal only (drop the columns/tables/constraints this migration added) — they do not attempt to restore data that existed before the migration ran, since none of these migrations delete or transform existing data.

## Known pre-existing gap (not part of this migration set)

`leads.phone` has historical records that were never retroactively normalized to a consistent format (carried over from earlier audit work, predates this migration set). Not a migration-safety issue, but worth a data-cleanup pass separately if phone-based duplicate detection accuracy matters at launch.
