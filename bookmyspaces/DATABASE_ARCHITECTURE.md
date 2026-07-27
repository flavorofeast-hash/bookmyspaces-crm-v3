# DATABASE_ARCHITECTURE.md

Last updated: 2026-07-27 (Release Candidate hardening pass). Supabase Postgres. **Live DB is the source of truth — verify against it, never assume migrations are complete** (ISS-009/010 lesson; reconciliation history in `audit/LIVE_SCHEMA_AUDIT.md`, `audit/SCHEMA_DRIFT_REPORT.md`, `audit/DATABASE_RECONCILIATION.md`).

For the current production apply status and a full pre-migration/rollback checklist, see `PRODUCTION_MIGRATION_CHECKLIST.md` — as of this update, 001-011 are live in production and 012-024 are written, idempotent, and verified but not yet applied.

## Migration Inventory (`supabase/migrations/`)

| # | Purpose |
|---|---|
| 001 | Initial schema (leads, conversations, knowledge_chunks + vector/ivfflat, core CRM) |
| 002 | WhatsApp (whatsapp_conversations, whatsapp_messages) |
| 003 | Proposals, bookings (banquet-shaped), invoices, payments |
| 004 | Campaigns, broadcast_campaigns, staff_performance (+ROLLBACK) |
| 005 | Stability patch (incl. match_knowledge_chunks RPC) |
| 006 | Final verification |
| 007 | Missing tables (packages w/ ai_description, analytics_events + track_event RPC) |
| 008 | Lead scoring |
| 009 | Documents undocumented live-production objects (activity_events etc.) |
| 010 | Proposal intelligence |
| 011 | email_log |
| 012 | **V3 foundation** (+ROLLBACK) — see below |
| 013 | proposal/invoice ↔ reservation FK links (+ROLLBACK) |
| 014 | Social foundation (social_accounts, social_interactions, social_posts, reviews) (+ROLLBACK) |
| 015 | admin_audit_log + refunds (+ROLLBACK) |
| 016 | leads.source CHECK: add 'proposal' (+ROLLBACK) |
| 017 | leads.source CHECK: add 'excel_import' (+ROLLBACK) |
| 018 | Customer Bulk Import tracking fields on leads (+ROLLBACK) |
| 019 | stage_transitions (funnel timing analytics) (+ROLLBACK) |
| 020 | broadcast_campaigns.type CHECK: add birthday/anniversary/dormant — fixes a real bug, UI already offered these (+ROLLBACK) |
| 021 | Campaign Scheduler: paused/cancelled status + recurrence columns (+ROLLBACK) |
| 022 | Win-back automation seed (recurring campaign row) (+ROLLBACK) |
| 023 | Event Package Management: hall/seating/AV/seasonal-pricing fields on packages, package_id on proposals (+ROLLBACK) |
| 024 | Event Sales Expansion: ai_interaction_log.interaction_type CHECK adds 'event_sales_advisor'/'upsell_recommendations' — fixes a real bug, those AI actions were silently failing to log (+ROLLBACK) |

Tooling: `npm run db:migrate:v3` / `db:rollback:v3` / `db:smoke-test:v3` (`scripts/apply-v3-migrations.mjs`, `smoke-test-v3.mjs`). Staging seed: `supabase/seed/staging_seed.sql`.

## V3 Foundation Schema (migration 012, 16 tables)

- **Identity/conversations:** `customer_identities` (multi-identifier: phone/email/wa/social → customer), `channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages`
- **Hospitality:** `properties`, `inventory_items` (rooms/halls/venues, typed), `meal_plans`, `rate_plans` (incl. seasonal), `addon_services`
- **Booking:** `reservations` (stay-shaped: check-in/out, occupancy, status workflow), `reservation_addons`
- **Platform:** `settings` (replaces Settings-page localStorage), `ai_prompts` (versioned), `knowledge_sources` (CRM-editable AI grounding), `ai_interaction_log`

## Legacy ↔ V3 Coexistence

`conversations` (JSONB array, website chat) and `whatsapp_conversations`/`whatsapp_messages` remain live until Phase 2 cutover: dual-write → parity verification → retire legacy write paths (tables kept read-only for history; no drops without explicit approval). `bookings` (003) stays for banquet events; `reservations` (012) is the stay model — do not merge them.

## Rules

1. Additive-only: no renames, drops, or type-narrowing without explicit approval + ROLLBACK file.
2. Every migration idempotent (`IF NOT EXISTS`) and re-runnable; paired ROLLBACK for structural changes.
3. RLS on every non-public table; no anon-writable policy without row-level scoping.
4. Access pattern (ISS-006): session-scoped client for user-facing CRUD; service-role only for cron/AI/imports/admin.
5. Known consolidation debt: `activity_logs` / `activity_events` / `analytics_events` overlap — converge on `activity_events` additively.
6. `admin_audit_log` (015), `payment_type` CHECK w/ 'refund' (015), and the social module tables (014 — see SOCIAL_MEDIA_ARCHITECTURE.md) have shipped since the note above was originally written; no longer pending.

## Post-013 additions (Direct Event Sales Engine + RC hardening)

- `packages` (007, extended 023): hall, seating_style, AV/lighting/sound fields, `addon_service_ids` (links to the existing `addon_services` table from 012 rather than duplicating it), seasonal_pricing, ai_description.
- `proposals` (extended 023): `package_id` FK for tracking which package a proposal came from — feeds both the Smart Proposal Generator and the AI Recommendation Success Rate metric on the Revenue Dashboard.
- `stage_transitions` (019) and `ai_interaction_log` (012, CHECK extended 024) power Revenue Intelligence's funnel timing and AI recommendation tracking — both degrade to `null`/empty rather than fabricating numbers if not yet live in a given environment.
- RC hardening pass (this update) found and fixed two real bugs hiding in CHECK constraints that predate it: migration 020 (campaign types the UI already offered but the DB rejected) and 024 (two AI interaction types that were silently failing to log). Neither required a schema redesign — both are single-constraint additive fixes, consistent with the additive-only rule above.
