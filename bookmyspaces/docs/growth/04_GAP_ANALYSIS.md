# 04 — Gap Analysis

Gaps are grouped into three kinds: **foundational risks** (must be resolved or explicitly accepted before building growth modules on top), **missing modules** (the growth-platform capabilities that don't exist yet), and **fragile-but-present** (built, but with a documented weak point). Nothing here is fixed in this pass — per the mission brief, these are documented, not repaired.

## A. Foundational risks (affect multiple modules below)

### A1. Migration 012/013 apply status is the single biggest blocker
`reservations`, `inventory_items`, `rate_plans`, `meal_plans`, `addon_services`, `customer_identities`, `unified_conversations` all come from migration 012. Per `RC1_DEPLOYMENT_READINESS.md`, this migration is **confirmed not applied to production**. Every growth module that reads booking/room/rate data (`08_CUSTOMER_JOURNEY.md`, `14_REFERRAL_SYSTEM.md`, `15_LOYALTY_PROGRAM.md`, parts of `18_ANALYTICS.md`) inherits this dependency. This is not a new finding — it is restated here because it is the load-bearing fact for this entire roadmap's sequencing (see `20_IMPLEMENTATION_ROADMAP.md`, Phase 0).

### A2. Live schema has already drifted from migration files at least once, confirmed this session
During this session's RC1 testing, the live `packages` table's actual columns (`slug`, `property`, `type`, `price`, `price_note`, `duration`, `capacity_min`, `capacity_max`, `sort_order`, ...) did not match migrations 007/023/024 (`venue`, `tier`, `base_price`, `max_guests`, `duration_hours`, `description`, `ai_description`). This was confirmed against the live schema, not assumed. **Implication for this plan**: any module design below that names a specific column is describing the *migration-file* shape, which is the best available source of truth in this sandbox (no live DB access), but must be re-verified against the live schema before implementation — the same lesson `DATABASE_ARCHITECTURE.md` already states ("Live DB is the source of truth — verify against it, never assume migrations are complete") and that this session independently re-confirmed.

### A3. An unresolved, actively-investigated pricing bug in the reservation write path
This session traced BUG-004 (Check Availability correctly quotes a nightly rate; the created reservation persists with `base_room_rate`/`final_room_rate` = 0) through `calculatePrice()` → `createReservationWithQuote()` → `createReservation()` → the exact object handed to `supabase.from('reservations').insert(...)`, by both reading the code and executing it (temporary, since-deleted Vitest traces). The traced value stayed correct (non-zero) at every boundary in the application code. The zeroing was not reproduced in this application code, which means it is happening either in the live database round-trip itself (a trigger, default, or column-drift analogous to A2) or in a deployed build that differs from this checkout — neither of which this sandbox can inspect (no network egress to the live Supabase project, confirmed this session). **Implication for this plan**: `08_CUSTOMER_JOURNEY.md` and any module keying a customer-facing trigger off `reservations.final_room_rate` (loyalty point accrual, post-stay revenue attribution) inherits this open bug and should not be considered safe to build against until it is resolved and independently re-verified against the live DB.

### A4. Cron routes fail open with zero auth if `CRON_SECRET` is unset
Documented in `API_SPECIFICATION.md`/`SECURITY_REVIEW.md`. Several growth modules below (`09_CAMPAIGN_ENGINE.md`'s lifecycle scheduler, `15_LOYALTY_PROGRAM.md`'s point-expiry job, `16_REVIEW_MANAGEMENT.md`'s review-fetch poller) are natural additions to `/api/cron/*`. Each new cron route inherits this risk until the env-var enforcement itself is fixed — out of scope for this documentation pass, but every module doc below explicitly flags it as a dependency/risk rather than silently assuming cron is safe.

### A5. Vector RAG infrastructure exists and is unused
`match_knowledge_chunks()` RPC and the `ivfflat` index have existed since migrations 001/005; retrieval today is keyword `ilike`. Every AI-opportunity section below that proposes better-grounded AI responses (content generation, review-response drafting, journey message personalization) is more effective once this is wired — flagged as a shared dependency rather than repeated as a fresh recommendation in each module.

### A6. Unified conversation cutover is incomplete
`unified_conversations` exists and both WhatsApp and website chat dual-write into it, but legacy tables (`conversations`, `whatsapp_conversations`) have not been retired (`IMPLEMENTATION_ROADMAP.md` Phase 2 is not marked complete). `07_OMNICHANNEL.md`, `08_CUSTOMER_JOURNEY.md`, and `10_SOCIAL_MEDIA.md` (DM inbox) all assume one conversation timeline — until cutover finishes, any of these built today would need to read from two systems, which is exactly the duplication this plan is instructed to avoid. Documented as a prerequisite, not solved here.

## B. Missing modules (the actual growth-platform gap)

| Missing capability | Nearest existing building block | Module doc |
|---|---|---|
| Lifecycle/behavioral marketing automation (not just scheduled broadcasts) | `campaign-scheduler.ts`, `queue.ts`, `stage_transitions` | `08_CUSTOMER_JOURNEY.md`, `09_CAMPAIGN_ENGINE.md` |
| Email marketing campaigns (not just transactional email) | `lib/email/*`, `email_log` | `13_EMAIL_MARKETING.md` |
| Referral program | `leads.source` enum already has room to add a value; `lifetime-value.ts` | `14_REFERRAL_SYSTEM.md` |
| Loyalty/points/tiering | `lifetime-value.ts`, `reservations` | `15_LOYALTY_PROGRAM.md` |
| Review management as a first-class workflow (not just data storage) | `reviews` table (migration 014), `social/interaction-service.ts` | `16_REVIEW_MANAGEMENT.md` |
| SEO/content operations | Content Studio page shell, `ai-provider.ts` | `17_SEO_AND_CONTENT.md` |
| Google Business Profile messaging/posts | None yet — same Meta-adapter pattern generalized | `11_GOOGLE_BUSINESS.md` |
| Marketing/attribution analytics (spend-to-booking) | `analytics_events`, `track_event()` RPC, Revenue Intelligence | `18_ANALYTICS.md` |
| AI-driven recommendations beyond package matching (churn risk, next-best-offer, content ideas) | `operator-assistant.ts`, `auto-package-recommendation.ts` | `19_AI_RECOMMENDATIONS.md` |

## C. Fragile-but-present (built, with a documented weak point)

- **Social module** — schema and adapter contract are real (migration 014, `MetaAdapter`), but gated entirely behind platform credentials not yet configured, and the Content Studio page's actual completeness was not independently re-verified in this pass (flagged, not assumed either way — see `10_SOCIAL_MEDIA.md`). **Status update (2026-08-07):** publishing (with retry/backoff), AI content generation (with variants/templates), Social CRM intent detection + auto-lead-linking, and marketing-dashboard top-content/best-posting-time are now built — see `docs/sprints/2026-08-07_social-growth-platform-phase4.md`. Still gated on real platform credentials/OAuth (unchanged).
- **AI orchestration engine** (`orchestration-engine.ts`, `orchestration-executor.ts`) — built, but disabled by default (`settings.orchestration.enabled = false`) and not exercised by Sprint 1. Any module proposing to route growth-triggered messages through it should treat it as unproven at production scale until that flag has real usage history.
- **Campaign attribution** — `campaign-scheduler.ts` tags `message_queue` rows with `campaign_id` going forward, but past sends have no attribution path (explicitly noted in the file's own header comment). `18_ANALYTICS.md` inherits this as a historical-data gap, not a bug to fix.
- **`activity_logs` / `activity_events` / `analytics_events` overlap** — `DATABASE_ARCHITECTURE.md` already flags this as known consolidation debt, converging additively on `activity_events`. Any module below that logs a new kind of growth event should target `activity_events`, not introduce a fourth overlapping table.

## What this means for sequencing

A1–A3 are the reason `20_IMPLEMENTATION_ROADMAP.md` places a "Foundation Verification" phase before any growth module that touches booking/pricing data — not because this plan is redesigning the reservation system, but because building revenue-facing growth features (loyalty accrual, referral payouts, journey triggers keyed on stay completion) on top of a write path with an open, unresolved zero-pricing bug and an unconfirmed migration would mean inheriting that bug's blast radius into new customer-facing surfaces.
