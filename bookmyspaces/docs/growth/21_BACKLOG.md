# 21 — Backlog

Flat, ticket-sized list, grouped by the phases in `20_IMPLEMENTATION_ROADMAP.md`. Ticket IDs are prefixed `GRW-` (Growth) to avoid colliding with any existing `BUG-`/`ISS-` numbering already in use in this project's audit trail. Each ticket names its source module doc for full context.

## Phase G0 — Foundation Verification

- **GRW-001** Run the one-shot migration-status verification query from `RC1_DEPLOYMENT_READINESS.md` §1 against the live database; produce a pass/fail report per table. *(`04_GAP_ANALYSIS.md` A1)*
- **GRW-002** Query `information_schema.columns` for `reservations`, `packages`, `reviews`, `analytics_events` against the live database; diff against migration-file expectations; document any drift found (following the same method that surfaced BUG-003). *(A2)*
- **GRW-003** Resolve BUG-004 (reservation pricing zeroing) at the database layer; re-run the create-reservation flow against a live/staging database and confirm `final_room_rate` persists correctly. *(A3)*
- **GRW-004** Verify unified-conversation dual-write parity (WhatsApp + website chat) over a real time window; produce a parity report; decide legacy-table retirement timing. *(A6, `07_OMNICHANNEL.md`)*
- **GRW-005** Fix `CRON_SECRET` fail-open behavior at the platform level before any new cron route in this backlog ships. *(A4)*

## Phase G1 — High-Leverage Wins

- **GRW-010** Verify current completeness of `/api/inbox*` against "one list, every channel" requirement; close any gap found. *(`07_OMNICHANNEL.md`)*
- **GRW-011** Build Inbox side panel surfacing `operator-assistant.ts`'s suggested reply / rewrite / tone / next-best-action. *(`06_AI_SALES_ASSISTANT.md`)*
- **GRW-012** Surface `runEventSalesAdvisor()` inline on the customer detail page (verify current button-triggered state first). *(`06`)*
- **GRW-013** Build `marketing_segments` table + `GET/POST /api/marketing/segments` + segment preview endpoint. *(`05_MARKETING_PLATFORM.md`)*
- **GRW-014** Build `campaign_attribution` linkage (campaign → lead/reservation). *(`05`)*
- **GRW-015** Build `email_suppressions` table + public unsubscribe endpoint (capability-token pattern) + wire suppression check into every marketing email send path. *(`13_EMAIL_MARKETING.md`)*

## Phase G2 — Core Growth Modules

- **GRW-020** Add `channel`/`segmentId` support to `/api/campaigns`; Campaigns page channel + segment picker. *(`09_CAMPAIGN_ENGINE.md`)*
- **GRW-021** Extend `WHATSAPP_MESSAGES`/email templates with review-request and win-back messages; wire into `checkOutReservation()`/a stay-lifecycle cron. *(`08_CUSTOMER_JOURNEY.md`)* — depends on GRW-003.
- **GRW-022** Build `journey_sends` idempotency tracking to prevent duplicate lifecycle messages. *(`08`)*
- **GRW-023** Settings UI for journey message toggles/timing. *(`08`)*
- **GRW-024** Implement `POST /api/social/posts/[id]/publish` (the gap `post-service.ts` explicitly documents as not yet built). *(`10_SOCIAL_MEDIA.md`)*
- **GRW-025** Implement `POST /api/social/posts/[id]/caption` (AI captioning) + publish-scheduler cron. *(`10`)*
- **GRW-026** Verify/complete Content Studio page against the publish pipeline above. *(`10`)*
- **GRW-027** Build Reviews queue UI + `GET /api/reviews` + `POST /api/reviews/[id]/respond`. *(`16_REVIEW_MANAGEMENT.md`)*
- **GRW-028** Admin-editable WhatsApp auto-responder copy (Settings page), replacing the current code-only template edits. *(`12_WHATSAPP_AUTOMATION.md`)*
- **GRW-029** Add channel/campaign breakdown to Revenue Dashboard + `/api/dashboard/revenue` additive params. *(`18_ANALYTICS.md`)*
- **GRW-030** Activate `staff_performance` table with real write paths. *(`18`)*
- **GRW-031** GBP API-availability spike (messaging + reviews) — time-boxed, before any further GBP work is scheduled. *(`11_GOOGLE_BUSINESS.md`)*
- **GRW-032** `POST /api/social/webhook/google` + GBP review-fetch job, contingent on GRW-031's findings. *(`11`)*

## Phase G3 — Multiplier Modules

- **GRW-040** Decide the shared reward-type model (cash / points / discount) used by both referral and loyalty. *(`14_REFERRAL_SYSTEM.md`, `15_LOYALTY_PROGRAM.md`)*
- **GRW-041** Build `referral_codes` + `referral_credits` tables + `POST /api/referrals/code` + `GET /api/referrals/credits`. *(`14`)*
- **GRW-042** Add optional referral-code capture to lead-creation paths (WhatsApp intake, website chat, manual entry). *(`14`)*
- **GRW-043** Build `loyalty_accounts` + `loyalty_ledger` tables + accrual hook in `checkOutReservation()`. *(`15`)* — depends on GRW-003, GRW-040.
- **GRW-044** Customer detail page: loyalty tier/points UI; Settings: tier thresholds/earn-rate config. *(`15`)*
- **GRW-045** Answer the public-website content-source question before building `content_items`. *(`17_SEO_AND_CONTENT.md`)*
- **GRW-046** Content Studio long-form content mode + AI generation grounded in `knowledge_sources`. *(`17`)* — depends on GRW-045.
- **GRW-047** Build `/api/ai/recommendations` aggregation + Dashboard widget, capped list, ranked by estimated impact. *(`19_AI_RECOMMENDATIONS.md`)* — depends on GRW-020 through GRW-029 having real data flowing.

## Cross-cutting / always-on

- **GRW-090** Wire every new admin-mutable write path added by this backlog into `audit-log.ts`, per existing convention.
- **GRW-091** Wire every new AI-generated recommendation type into `ai_interaction_log` with an additive `interaction_type` CHECK extension, following migration 024's precedent.
- **GRW-092** Update `CHANGELOG.md` and the relevant master doc (`DATABASE_ARCHITECTURE.md`, `API_SPECIFICATION.md`, `AI_ARCHITECTURE.md`) at the end of every phase, per the root `IMPLEMENTATION_ROADMAP.md`'s standing rule.
