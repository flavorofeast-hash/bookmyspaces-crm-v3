# MASTER_DATABASE.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Canonical database reference. Consolidates `DATABASE_ARCHITECTURE.md` plus this session's own direct RC1 findings (which is why this document is more cautious about "live vs. migration-file" status than the source doc it consolidates — that caution is itself a durable lesson, not overcaution).

## The one rule that matters most in this document

**The live database is the source of truth. A migration file describes intent, not necessarily reality.** This is not a theoretical caveat — during this repository's own RC1 testing, the live `packages` table's actual columns (`slug`, `property`, `type`, `price`, `price_note`, `duration`, `capacity_min`, `capacity_max`, `sort_order`, ...) did not match what migrations 007/023/024 describe (`venue`, `tier`, `base_price`, `max_guests`, `duration_hours`, `description`, `ai_description`). Every table map below is the best available description from migration files and prior audits — **re-verify against `information_schema.columns` on the live database before writing code against any table**, especially `packages`, `reservations`, `reviews`, and `analytics_events`. **Exact verification SQL for the `packages` drift specifically:** `scripts/verify-packages-columns.sql` (added 2026-08-01, RC2 Final pass, ENG-035) — checks both the application-expected names and the alternate names recorded above in one query.

**Strategy B reconciliation (2026-08-02):** migration `028_reconcile_packages_schema_drift.sql` (+ paired `_ROLLBACK.sql`) renames the live table's 3 confirmed-drifted columns (`property`→`venue`, `price`→`base_price`, `capacity_max`→`max_guests`) via `ALTER TABLE ... RENAME COLUMN`, so the live table matches migrations 007/023/024 and every application read/write instead of the other way round. **Apply status: Confirmed live (2026-08-02)** — a post-apply run of `scripts/verify-packages-columns.sql` against production, reported by the operator, shows `venue`/`base_price`/`max_guests` PRESENT and `property`/`price`/`capacity_max` ABSENT. (This status is recorded per the operator-reported verification-script output; it has not been independently re-run against production by an AI session in this repo's history, consistent with every other apply-status entry in this table — see the Database Evolution Policy below.) The migration was intentionally scoped to only the 3 columns the verification report confirmed drifted — the additional live-only columns the original RC1 finding also recorded (`slug`, `type`, `price_note`, `duration`, `capacity_min`, `sort_order`) were NOT touched by it and their live status remains unconfirmed; see the migration file's header for why, and see the note directly below on a bug (now fixed) in how the verification script itself rolled `slug`/`type` into its drift verdict.

**Verification script TL;DR bug, fixed 2026-08-02:** `scripts/verify-packages-columns.sql`'s original rollup logic flagged "drift confirmed" if *any* of `property`/`price`/`capacity_max`/`slug`/`type` existed — but `slug` and `type` are legitimate additional columns on the live table, not replacement names for `venue`/`base_price`/`max_guests`, so their presence should never have gated the verdict. This surfaced for real after migration 028 was applied: `slug`/`type` were untouched by 028 (out of its scope) and still existed, so the script kept reporting "CONFIRMED: drift" even though the actual replacement columns (`property`/`price`/`capacity_max`) were gone. The script now bases its TL;DR verdict solely on `property`/`price`/`capacity_max` presence; `slug`/`type`/`tier`/`duration_hours` remain in the detail output for visibility but no longer affect the verdict. Fix verified against 6 representative column-state fixtures (see `STRATEGY_B_MIGRATION_REPORT.md`'s follow-up verification section) — no live database access was used or required to fix this, since the bug was in the script's SQL logic, not the data.

## Migration inventory (`supabase/migrations/`, 28 files)

| # | Purpose | Apply status (last known) |
|---|---|---|
| 001 | Initial schema (leads, conversations, knowledge_chunks + vector) | Presumed live |
| 002 | WhatsApp tables | Presumed live |
| 003 | Proposals, bookings, invoices, payments | Presumed live |
| 004 | Campaigns, broadcast_campaigns, staff_performance | **Unverified — possible not-live risk flagged in prior audits** |
| 005 | Stability patch (`match_knowledge_chunks` RPC) | Presumed live |
| 006 | Final verification | Presumed live |
| 007 | `packages`, `analytics_events` + `track_event` RPC | Presumed live — `packages`' `venue`/`base_price`/`max_guests` drift (see the header note above) is **reconciled as of migration 028, confirmed live 2026-08-02** |
| 008 | Lead scoring | Presumed live |
| 009 | Documents undocumented production objects | Presumed live |
| 010 | Proposal intelligence | Presumed live |
| 011 | `email_log` | Presumed live |
| 012 | **V3 foundation** (16 tables: reservations, inventory_items, rate_plans, meal_plans, addon_services, customer_identities, unified_conversations, settings, ai_prompts, knowledge_sources, ai_interaction_log, etc.) | **Confirmed NOT applied to production** as of the most recent RC1 readiness check |
| 013 | Proposal/invoice ↔ reservation FK links | Same status as 012 (depends on it) |
| 014 | Social foundation (social_accounts, social_interactions, social_posts, reviews) | Unverified |
| 015 | `admin_audit_log` + refunds | Unverified |
| 016 | ~~Extends `leads.source` with `'proposal'`~~ — drafted, **never applied, retired this session**. See "Column Semantics — `leads.source`" below for why. Left in `supabase/migrations/` as a historical record only; do not apply. | **Retired — do not apply** |
| 017 | Extends `leads.source` with `excel_import` — rewritten this session to build directly on the original 6-value list (001), independent of 016 | Unverified — not yet applied |
| 018–021 | Customer bulk import fields, stage_transitions, campaign type/scheduler extensions | Unverified |
| 022 | Win-back automation seed | Unverified |
| 023–024 | Event Package Management + Event Sales Expansion (packages extensions, ai_interaction_log CHECK fix) | Unverified. Their `venue`/`base_price`/`max_guests`-dependent columns are unaffected by the drift now that migration 028 has reconciled it (confirmed live 2026-08-02) — the 023/024-added columns themselves (`event_types`, `hall`, `seasonal_pricing`, etc.) remain independently unverified against production |
| 025 | `orchestration_decisions` (observability) | Newest as of the RC1 pass; gated behind a disabled feature flag, not urgent |
| 026 | `leads.campaign/landing_page/utm_source/utm_medium/utm_campaign/referral` — Campaign Landing Page attribution | **Never verified against production** — postdates every audit in this repo until `PRODUCTION_VERIFICATION_REPORT.md` (2026-08-01), which is also the first document to record it at all. See ENG-034. |
| 027 | `follow_ups.property/purpose/guest_count/budget` — Site Visit Scheduling (Sprint 1) | **Never verified against production, highest-severity unknown of the two newest migrations** — `scheduleSiteVisit()` INSERTs these columns by name, so a missing migration is a hard failure (not a graceful `SELECT *` degradation) on every site-visit request. See ENG-033, `PRODUCTION_VERIFICATION_REPORT.md` §1. |
| 028 | Reconciles `packages` schema drift (Strategy B) — `RENAME COLUMN property→venue, price→base_price, capacity_max→max_guests` | **Confirmed live 2026-08-02** (operator-reported `scripts/verify-packages-columns.sql` run: venue/base_price/max_guests PRESENT, property/price/capacity_max ABSENT). Reversible via paired `_ROLLBACK.sql`. Does not touch the other live-only columns (`slug`/`type`/`price_note`/`duration`/`capacity_min`/`sort_order`) reported alongside the original drift finding — out of scope, see file header. |

**Tooling gap, worth knowing**: `npm run db:migrate:v3` (`scripts/apply-v3-migrations.mjs`) only applies migrations 012 and 013 — not 014 through 024, despite documentation elsewhere describing it as covering the full V3 batch. Anyone applying migrations should apply 014–024 by hand, in order, and not assume the npm script covers them.

## Full table inventory (52 tables across all 25 migrations)

| Domain | Tables |
|---|---|
| CRM core | `leads`, `activity_logs`, `activity_events`, `follow_ups`, `documents`, `lead_imports` |
| Conversations — legacy (live) | `conversations`, `whatsapp_conversations`, `whatsapp_messages`, `messages` |
| Conversations — V3 (built, not cut over) | `customer_identities`, `channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages` |
| Hospitality catalog | `properties`, `inventory_items`, `meal_plans`, `rate_plans`, `addon_services`, `packages` |
| Booking | `reservations`, `reservation_addons`, `bookings` (legacy, banquet-shaped — kept deliberately separate from `reservations`, do not merge), `blocked_dates` |
| Sales | `proposals`, `invoices`, `payments`, `stage_transitions` |
| Marketing | `campaigns`, `broadcast_campaigns`, `festival_calendar`, `message_queue`, `scheduled_jobs` |
| Social | `social_accounts`, `social_interactions`, `social_posts`, `reviews` |
| AI / knowledge | `knowledge_chunks` (vector/ivfflat), `knowledge_sources`, `ai_prompts`, `ai_interaction_log`, `ai_summaries` (dormant), `orchestration_decisions` |
| Ops / analytics | `analytics_events`, `notification_settings`, `escalations`, `staff_performance` (dormant), `system_health_log`, `admin_audit_log` |
| System | `settings`, `email_log`, `user_profiles` |

**Dormant tables** (schema exists, no confirmed read/write code path as of this audit): `staff_performance`, `ai_summaries`. Use these before creating anything that overlaps their evident purpose.

**Known, accepted overlap (do not "fix" without a deliberate decision)**: `activity_logs` / `activity_events` / `analytics_events` — three tables with overlapping purpose. The existing, documented direction is to converge additively on `activity_events` over time, not to pick a winner and migrate destructively. Any new event-logging need should default to `activity_events` unless there's a specific reason to use one of the other two.

## Column Semantics — `leads.source` (Lead Source)

Resolved this session after a real production incident, recorded here because the ambiguity had already caused one shipped bug and nearly caused a second. Worth a standing definition, not just a sprint note, since this column will keep attracting new writers as the CRM grows.

**`leads.source` represents acquisition channel — how a customer first reached the business.** It is not an internal workflow stage, and not a record of how the CRM row itself was created. It is a first-class input to real, live logic, so it has to stay a clean channel list:

- `src/lib/lead-scorer.ts`'s `sourceScores` map scores channel quality (`referral=10, whatsapp=8, instagram=7, website=6, justdial=5, other=4`) as part of AI lead scoring.
- `src/app/api/dashboard/revenue/route.ts`'s `bySource`, `src/lib/campaigns.ts`'s `bySource` (feeds the "Customer acquisition trend" chart), and `src/lib/analytics/revenue-intelligence.ts`'s `revenueByLeadSource` all report acquisition and revenue attribution grouped directly by this column's raw value, unfiltered — any non-channel value written here shows up as its own bucket in all three.

**Current valid values** (`leads_source_check`, originally `001_initial_schema.sql`, extended by `017_leads_source_add_excel_import.sql`): `website`, `whatsapp`, `instagram`, `justdial`, `referral`, `other`, `excel_import`.

`excel_import` is the one accepted exception to "channel, not process," and it's a deliberate, narrow one: a bulk-imported row genuinely has no channel information, and inventing one would be worse than an honest "we don't know, this came from a file" marker distinct from `other`. Any future proposal to add a value here should be tested against the same question: does it name a channel a customer actually arrived through, or does it describe something the CRM did internally? Only the former belongs in this column.

**Rejected precedent, kept as a citable example for the next time this comes up:** the standalone-proposal-for-a-new-customer flow (`ensureLeadForProposal()`, `src/lib/proposals/proposal-service.ts`) briefly wrote `source: 'proposal'` when no existing lead matched by phone/email — a workflow label, not a channel. A migration to widen the constraint (`016_leads_source_add_proposal.sql`) was drafted, and a second migration (the original `017`) was built on top of it, before the decision was reversed: neither migration had actually shipped to production, and a dependency review found nothing in later migrations or live application code that needed `'proposal'` to be valid. The fix uses `source: 'other'` (the true channel is genuinely unknown at that point) plus `proposals.lead_id` — already set on the very next insert — which correctly models "this lead has a proposal" without overloading `source`. Migration 016 is retired; see the Migration Inventory table above.

**Rule for every future writer of `leads.source`:** if the value you're about to write answers "how did we create or receive this record" rather than "where did this customer come from," it does not belong in this column. Write `other`, and record the actual distinguishing fact in its own proper place — `proposals.lead_id` for proposal-originated leads, `lead_imports.id` via `imported_via_import_id` for bulk-imported ones, `source_channel` for WhatsApp's platform-surface detail (Facebook/Instagram/Website click-to-chat).

## Domain Relationship Diagram

A relationship view across the domain groupings in the table inventory above, matching `MASTER_ARCHITECTURE.md`'s Domain Map so a schema question and an architecture question about the same feature point to the same domain:

```
properties
   └─ inventory_items (rooms/halls/venues)
         ├─ rate_plans ──┐
         ├─ meal_plans ──┼─→ reservations ──→ reservation_addons
         └─ addon_services ──┘        │
                                       ├─→ invoices ──→ payments
                                       └─→ proposals (migration 013 FK links)

leads ──→ proposals ──→ invoices ──→ payments
  │
  └─→ activity_logs / activity_events (converging)

customer_identities ──→ unified_conversations ──→ unified_conversation_channels ──→ unified_messages
  (legacy, still live in parallel: conversations / whatsapp_conversations / whatsapp_messages / messages)

knowledge_sources ──→ knowledge_chunks (vector) ──→ ai_interaction_log ──→ orchestration_decisions

social_accounts ──→ social_interactions / social_posts / reviews
```

This is a logical relationship view derived from the migration files, not a generated ER diagram — treat it with the same "presumed, not confirmed" caution as the rest of this document for anything beyond `packages` (see the one rule above). Update it additively as new domains/FKs are introduced; don't let it silently drift from the table inventory.

## Data Ownership Matrix

Which service/module is the authoritative writer for each domain's tables — i.e., where a new feature needing to write one of these tables should route through, rather than writing to the table directly from a route handler:

| Domain | Tables | Authoritative writer(s) |
|---|---|---|
| CRM core | `leads`, `activity_logs`/`activity_events`, `follow_ups` | `lead-stage-manager.ts`, lead API routes |
| Conversations (V3) | `customer_identities`, `channels`, `unified_conversations`, `unified_messages` | `unified-conversation-service.ts`, `resolve-identity.ts` |
| Conversations (legacy) | `conversations`, `whatsapp_conversations`, `whatsapp_messages`, `messages` | WhatsApp webhook route, legacy chat routes — dual-write during cutover, per `MASTER_ARCHITECTURE.md` |
| Hospitality catalog | `properties`, `inventory_items`, `rate_plans`, `meal_plans`, `addon_services`, `packages` | `catalog-service.ts` and catalog admin routes only — never written ad hoc from booking/pricing code |
| Booking | `reservations`, `reservation_addons`, `blocked_dates` | `reservation-workflow.ts`, `availability-service.ts`, `pricing-service.ts` |
| Sales | `proposals`, `invoices`, `payments`, `stage_transitions` | proposal/invoice API routes and their service modules |
| Marketing | `campaigns`, `broadcast_campaigns`, `festival_calendar`, `message_queue`, `scheduled_jobs` | `campaign-scheduler.ts`, `queue.ts` |
| Social | `social_accounts`, `social_interactions`, `social_posts`, `reviews` | Meta adapter (schema live; write path incomplete pending publishing pipeline) |
| AI / knowledge | `knowledge_chunks`, `knowledge_sources`, `ai_prompts`, `ai_interaction_log`, `orchestration_decisions` | `ai-provider.ts`/`ai.ts` orchestration path only |
| Ops / analytics | `analytics_events`, `system_health_log`, `admin_audit_log` | `audit-log.ts`, `track_event` RPC (migration 007) |
| System | `settings`, `email_log`, `user_profiles` | settings API routes, `src/lib/env.ts`-adjacent system code |

A table with more than one listed writer above (`conversations`-family during dual-write) is a known, temporary, and already-documented exception — not license to add a second writer elsewhere. Any new feature that would need to write outside its domain's authoritative writer is a signal to reuse that writer's service function, not to add a new direct write path.

## Rules for every future migration (non-negotiable, restated because they're the whole point of this document)

1. **Additive only.** No `DROP`, no `RENAME`, no type-narrowing, without an explicit, recorded approval and a paired `_ROLLBACK.sql` file — the existing convention for every structural migration in this repo.
2. **Idempotent.** `IF NOT EXISTS` / `IF EXISTS` guards throughout, safe to re-run.
3. **RLS on every new table.** Follow the existing pattern: `service_role`-only policy for admin/system tables, or an explicit `anon`-read policy only where the data is genuinely public (e.g., `packages`, per migration 007's `packages_anon_read` policy) — never default to an unscoped `authenticated` policy without recording that authorization is actually enforced at the API layer (see `MASTER_ARCHITECTURE.md`'s cross-cutting-concerns note on this).
4. **Verify against the live schema before writing the migration**, not just before writing application code — the drift already found on `packages` means a new additive column could collide with something already added out-of-band.
5. **A migration is not "done" until independently confirmed applied to the live database.** "Written, idempotent, and verified" (as several migrations in the table above are described in prior docs) is not the same claim as "applied" — keep these two states distinct in every future status report, because conflating them is exactly what has caused confusion in this project's history.

## Database Evolution Policy

Governance layer on top of the five rules above — those rules describe how to write a correct migration; this describes how a schema change gets from "proposed" to "live" without repeating this project's own history of drift and unverified-apply confusion:

1. **Every schema change starts as a proposal in `MASTER_BACKLOG.md` or a growth-platform ticket (`docs/growth/21_BACKLOG.md`)** referencing the domain it belongs to (per the Domain Relationship Diagram above) — not as an ad hoc migration file with no prior record.
2. **A new migration is reviewed against the Data Ownership Matrix** before being written: does it belong to an existing domain's authoritative writer, or does it introduce a new domain? New domains are rare and should be reflected back into `MASTER_ARCHITECTURE.md`'s Domain Map in the same change, not left as an orphan table.
3. **Apply status is a first-class fact, tracked explicitly**, per the existing Migration Inventory table's "Apply status" column — a migration is not considered part of the system's real state until its apply status reads "Confirmed live," and every status besides that is treated as not-yet-real for planning purposes (this is the direct, hard-won lesson from migrations 012–024's unverified/not-applied status and the `packages` drift).
4. **Every migration's landing is recorded in a `docs/releases/` entry** (per that directory's template) at the time it's actually applied — closing the loop that this project's history shows breaks most often: a migration file existing is not the same event as a migration being applied, and only a dated release record makes that distinction checkable later.
5. **No destructive consolidation without an explicit, dated approval recorded in this file.** The `activity_logs`/`activity_events`/`analytics_events` overlap and the `bookings`/`reservations` split are both named, accepted exceptions under this policy — convergence happens additively, over time, never as a single destructive migration, unless a future dated entry here explicitly overrides that.
6. **This policy governs schema only** — application-level data lifecycle (retention, export, deletion) is out of scope for this document and should be recorded in `MASTER_SECURITY.md` if/when it becomes a requirement.

## Assumptions recorded (not guessed)

- This document assumes the migration-file descriptions for tables *other than* `packages` are accurate, since only `packages` has been directly, empirically checked against the live schema this session. This is an explicit, named assumption — not a claim of verification — for `reservations`, `reviews`, `analytics_events`, and every other migration-012-and-later table.
- Assumed: migrations 001–011 are live (every source document agrees on this), but this itself has never been independently re-verified against the live database in any session on record — carried forward as "presumed," not "confirmed."
