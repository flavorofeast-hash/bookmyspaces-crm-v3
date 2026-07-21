# DATABASE_ARCHITECTURE.md

Last updated: 2026-07-21. Supabase Postgres. **Live DB is the source of truth — verify against it, never assume migrations are complete** (ISS-009/010 lesson; reconciliation history in `audit/LIVE_SCHEMA_AUDIT.md`, `audit/SCHEMA_DRIFT_REPORT.md`, `audit/DATABASE_RECONCILIATION.md`).

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
6. Pending additions per roadmap: `admin_audit_log`, `payment_type` CHECK w/ 'refund', social module tables (`social_accounts`, `social_interactions`, `social_posts`, `reviews` — see SOCIAL_MEDIA_ARCHITECTURE.md).
