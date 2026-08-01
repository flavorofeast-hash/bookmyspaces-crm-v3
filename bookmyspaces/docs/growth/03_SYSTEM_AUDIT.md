# 03 — System Audit

Full inventory of what exists in the repository today, gathered by reading `supabase/migrations/*.sql` (25 migrations), every `src/lib/**/*.ts` service, every `src/app/api/**/route.ts`, every `src/app/(crm)/**/page.tsx`, and the existing top-level architecture docs. This is the ground truth every module design in `05`–`19` builds on.

## Database (Supabase Postgres)

### Tables that exist today (52, across 25 migrations)

| Domain | Tables |
|---|---|
| CRM core | `leads`, `activity_logs`, `activity_events`, `follow_ups`, `documents`, `lead_imports` |
| Conversations (legacy, live) | `conversations` (website chat, JSONB), `whatsapp_conversations`, `whatsapp_messages`, `messages` |
| Conversations (V3, built not cut over) | `customer_identities`, `channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages` |
| Hospitality catalog | `properties`, `inventory_items`, `meal_plans`, `rate_plans`, `addon_services`, `packages` |
| Booking | `reservations`, `reservation_addons`, `bookings` (legacy banquet-shaped, kept separate per `DATABASE_ARCHITECTURE.md`), `blocked_dates` |
| Sales | `proposals`, `invoices`, `payments`, `stage_transitions` |
| Marketing | `campaigns`, `broadcast_campaigns`, `festival_calendar`, `message_queue`, `scheduled_jobs` |
| Social (schema shipped, migration 014) | `social_accounts`, `social_interactions`, `social_posts`, `reviews` |
| AI / knowledge | `knowledge_chunks` (vector, ivfflat), `knowledge_sources`, `ai_prompts`, `ai_interaction_log`, `ai_summaries` (dormant), `orchestration_decisions` |
| Ops / analytics | `analytics_events`, `notification_settings`, `escalations`, `staff_performance` (dormant), `system_health_log`, `admin_audit_log` |
| System | `settings`, `email_log`, `user_profiles` |

### Production apply status (per `DATABASE_ARCHITECTURE.md` / `RC1_DEPLOYMENT_READINESS.md`)

- Migrations 001–011: presumed live (predate migration tooling), not independently re-verified this pass.
- Migrations 012–013 (Reservation Platform — 16 tables including `reservations`, `inventory_items`, `rate_plans`): **confirmed not applied** as of the most recent RC1 readiness pass. Everything built on these (reservations, the growth modules that reference bookings/rooms below) is blocked on this migration landing first — see `04_GAP_ANALYSIS.md`.
- Migrations 014–024: unverified apply status; `npm run db:migrate:v3` only covers 012–013, a real tooling gap already flagged in `RC1_DEPLOYMENT_READINESS.md`.
- Migration 025: newest, gated behind a disabled feature flag, not required for this plan.

### Dormant tables (schema exists, zero read/write callers found)

- `staff_performance` — reserved for exactly the kind of sales-productivity tracking `18_ANALYTICS.md` needs; no migration or code changes required to start using it.
- `ai_summaries` — reserved for the "automated AI daily summaries" line item already in `IMPLEMENTATION_ROADMAP.md` Phase 7; relevant to `19_AI_RECOMMENDATIONS.md`.

## AI layer

- **Provider abstraction**: `src/lib/providers/ai-provider.ts` — Claude primary, OpenAI fallback, one interface. `chatWithAI()` in `src/lib/ai.ts` is the single channel-agnostic entry point; no direct SDK usage anywhere else in the codebase (confirmed by grep).
- **Grounding**: `knowledge_sources` (012) + `knowledge_chunks` (001, vector) + `packages.ai_description` (007). Retrieval today is keyword `ilike` (`src/lib/knowledge/knowledge-retrieval.ts`), not the vector RPC (`match_knowledge_chunks()`, live since migration 005 but unused) — a real, already-documented gap.
- **Context/memory**: `src/lib/ai/context-builder.ts` assembles per-customer context from `customer_identities`, `timeline-service`, prior conversations/proposals/reservations.
- **Orchestration**: `src/lib/ai/orchestrator.ts`, `orchestration-engine.ts`, `orchestration-executor.ts`, `decision-table.ts`, `intent-detector.ts`, `slot-memory.ts`, `tool-registry.ts` — a genuinely sophisticated orchestration layer already exists, gated behind `settings.orchestration.enabled` (default false).
- **Operator assist**: `src/lib/ai/operator-assistant.ts` — suggested replies, rewrite, translate, tone, upsell/cross-sell, next-best-action, plus the Direct Event Sales Engine's `runEventSalesAdvisor()`. Built, no console UI surfacing it yet.
- **Automation**: `src/lib/extract-lead-details.ts` (lead auto-extraction), `src/lib/leads/auto-package-recommendation.ts` (auto package + draft proposal after qualification), `src/lib/lead-scorer.ts`.
- **Safety rules** (from `AI_ARCHITECTURE.md`, load-bearing for every AI feature designed below): grounded answers only, confidence logged on every interaction, no autonomous sends of documents/payments/destructive changes, all AI writes go through the same validated service layer as human writes.

## Reservation / catalog / pricing

- `src/lib/reservations/{availability-service,reservation-service,reservation-workflow,property-service}.ts` — availability checking, CRUD, Check-Availability→Calculate-Price→Create-Reservation workflow, confirm/cancel/check-in/check-out state machine.
- `src/lib/pricing/pricing-service.ts` — `getInventoryItemRate()` (rate_plans-based, migration-012-dependent) and `getActivePackagePrices()` (live `packages` table fallback, used today by the WhatsApp pricing reply).
- `src/lib/admin/catalog-service.ts` + `/api/admin/catalog/[entity]` + Catalog page — CRUD for properties/rooms/rate plans/meal plans/add-ons/packages, replacing the former raw-SQL-only workflow.
- `src/lib/packages/package-service.ts` — Event Package Management (Direct Event Sales Engine), reusing `addon_services`/`inventory_items`/`meal_plans` rather than duplicating them.
- `src/lib/tax.ts` — default tax rate with per-package override.

## Sales pipeline

- `leads` + Kanban (`src/app/(crm)/kanban`) + lead scoring (`lib/lead-scorer.ts`) + follow-ups (`lib/create-lead-with-journey.ts`, `/api/followups`, `/api/cron/followups`).
- Proposals: `src/lib/proposals/proposal-service.ts`, PDF generation (`proposal-pdf.ts`), share/track-view, invoice + payment + payment-reminder + receipt + booking-confirmation routes, `proposal-intelligence.ts`.
- Revenue Intelligence: `src/lib/analytics/revenue-intelligence.ts` — funnel, forecast, proposal/booking/customer analytics, sales productivity, all computed from a small fixed set of bulk queries (no N+1), reused rather than duplicated by `18_ANALYTICS.md`.
- Customer Lifetime Value: `src/lib/customers/lifetime-value.ts` — per-customer revenue total with an explicit double-counting rule against `reservations.proposal_id`. Directly reusable for `14_REFERRAL_SYSTEM.md`/`15_LOYALTY_PROGRAM.md` tiering.

## Channels (messaging)

- **WhatsApp**: `src/lib/whatsapp/*` (auto-qualify, auto-responder, conversation-manager, detect-source, lead-resolver, normalize-phone, send-message, verify-signature) + `lib/queue.ts` (rate-limited, spam-checked outbound queue, `smartSend()`) + `lib/templates.ts` (session message templates) + `/api/whatsapp/{webhook,send,campaigns}`.
- **Website chat**: `/api/chat`, public, rate-limited (20/min/IP).
- **Email**: `src/lib/email/{provider,send,templates}.ts` — Resend-backed, provider-agnostic, logged to `email_log`. Outbound only today; no inbound adapter (a real gap, see `13_EMAIL_MARKETING.md`).
- **Unified conversation engine**: `src/lib/conversations/{unified-conversation-service,outbound-dispatcher,whatsapp-unified-sync}.ts` — built, WhatsApp dual-writes into it, website chat does too (per `CHANGELOG.md`'s 2026-07-22 session), but legacy tables are not yet retired. See `07_OMNICHANNEL.md`.
- **Social**: `src/lib/social/{adapter-registry,interaction-service,dm-capture-service,meta-lead-capture,post-service,types}.ts` + `adapters/meta-adapter.ts` — schema and adapter contract shipped (migration 014), Meta (FB/IG) adapter credential-gated, `/api/social/{webhook/[platform],interactions,posts}`. UI: one Social page exists; Content Studio page exists as a shell (`src/app/(crm)/content-studio/page.tsx` — verify actual completeness before assuming it's done, see `04_GAP_ANALYSIS.md`).

## Campaigns / marketing (as it exists today)

- `src/lib/campaigns.ts` — `generateFestivalMessage()` (AI-generated WhatsApp festival greetings), segment building (`buildSegment()`).
- `src/lib/campaign-scheduler.ts` — routes campaign sends through `queue.ts` instead of a synchronous per-request loop; tags `message_queue` rows with `campaign_id` for attribution.
- `campaigns`/`broadcast_campaigns` tables, `/api/campaigns`, Campaigns page. Migration 022 seeded a recurring win-back campaign row.
- **What's missing**: email campaigns (WhatsApp/festival-message only today), lifecycle/behavioral triggers beyond scheduled sends, and audience segmentation beyond what `buildSegment()` currently supports. See `09_CAMPAIGN_ENGINE.md`.

## Dashboards / analytics

- `/api/dashboard/{stats,operations,revenue,intelligence}` + corresponding pages.
- `src/lib/analytics/revenue-intelligence.ts` (see above).
- `analytics_events` table + `track_event()` RPC (migration 007) — generic event tracking, currently used narrowly; real capacity for UTM/attribution tracking (`18_ANALYTICS.md`) without new tables.

## Auth / security / ops baseline

- `src/lib/auth-guard.ts` (`requireAuth()`/`requireRole()`), `src/middleware.ts` — session + RBAC on every route except the documented public allowlist (`API_SPECIFICATION.md`).
- `src/lib/validation.ts` — zod schema + `parseBody()` convention, `.strict()` on admin-facing schemas, mandatory on every new route per `API_SPECIFICATION.md`.
- `src/lib/rate-limit.ts` — in-memory rate limiting on `/api/chat` and social webhook; **cron routes fail open if `CRON_SECRET` is unset in production** — a real, already-flagged security risk relevant to any new scheduled job this plan adds (see `04_GAP_ANALYSIS.md`).
- `src/lib/audit-log.ts` — wired into settings/catalog/refund writes; every module below that adds admin-mutable data should wire into this, not invent a parallel audit trail.

## UI inventory (`src/app/(crm)/*/page.tsx`)

`campaigns`, `catalog`, `content-studio`, `customers` (+`[id]`), `dashboard` (+`intelligence`,`operations`,`revenue`), `inbox`, `kanban`, `knowledge-base`, `proposals` (+`new`,`share/[token]`), `reservations` (+`[id]`,`calendar`), `settings`, `social`, `whatsapp`. No dedicated pages yet for: marketing automation/journeys, referrals, loyalty, review management as a distinct surface (reviews currently only reachable via the Social page's data model), or a unified inbox that has fully replaced the separate WhatsApp/Inbox pages.
