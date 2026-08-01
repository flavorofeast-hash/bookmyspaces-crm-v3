# MASTER_ROADMAP.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

## Shipped since this document was frozen (not yet reflected in the phase numbering below)

This roadmap's Phase 0–7 structure predates a real, shipped body of work — restated here rather than renumbering the phases (that would be a redesign; this addendum is documentation only). Full detail: `docs/sprints/2026-08-01_revenue-conversion-and-rc2-hardening.md`, `docs/releases/2026-08-01_release-candidate-2.md`.

- **Direct Event Sales Engine, Site Visit Scheduling (Sprint 1/1.5).** AI chat conversationally captures a preferred visit date/time and books it via the existing `follow_ups` table (migration 027) — reuses `scheduleSiteVisit()`, guarded against duplicates by `leadHasScheduledVisit()`.
- **Revenue Conversion Engine (Sprint 2).** Every completed Site Visit auto-triggers Package Recommendation → Proposal Draft (`runVisitToProposalConversion` → `runAutoPackageRecommendation`), with a code-level Property Intelligence guard (Skyline-never-events, Monurama-100-cap) shared by every entry point. Revenue Probability scoring extended (`opportunity-score.ts`) with site-visit and proposal-engagement signals.
- **Founder Dashboard (Sprint 3A).** Today's Opportunities / Revenue Pipeline / Today's Schedule (merged timeline) / AI Morning Brief / Lost Revenue Summary — reuses `revenue-intelligence.ts`, `opportunity-score.ts`, `lead-intelligence.ts`; no new tables, no duplicate calculations.
- **AI Hospitality Sales Consultant Policy.** Merged into the live `SYSTEM_PROMPT` (`src/lib/ai.ts`) and documented as the canonical policy in `docs/business/07_AI_BEHAVIOR_RULES.md` — single source of truth, no parallel prompt files.
- **RC2 validation passes.** End-to-end journey validation (`RC2_READINESS_REPORT.md`) and production-database verification (`PRODUCTION_VERIFICATION_REPORT.md`) — the latter surfacing two previously-unchecked migrations (026, 027) and a previously under-weighted `packages` column-drift risk (ENG-035), all still open.
- **Omnichannel Communication Platform, Version 2.0 (2026-08-01).** Closed the "ONE AI across every channel" gap: Facebook Messenger and Instagram DM (`dm-capture-service.ts`, already built) never generated an AI reply — new `dm-responder.ts`/`dm-send.ts` reuse `chatWithAI()`/`SYSTEM_PROMPT` verbatim (no channel-specific prompt), gated by the same `ai_active` human-handoff flag and `checkAndApplyHandoff()` escalation policy the WhatsApp orchestration path already uses. Unified Inbox (`/api/inbox`) extended with the required CRM fields (Opportunity Score, Proposal Status, Next Action, Assigned Owner) by reusing `getOpportunityScoreForLead()`/`computeIntelligence()` — the same functions Founder Dashboard already used, not a second implementation. Founder Dashboard required no changes — verified already channel-agnostic (reads `leads`/`proposals` with no source filter). Full detail: `docs/sprints/2026-08-01_omnichannel-dm-ai-response.md`.
- **Marketing Intelligence Platform, Version 2.1 (2026-08-01).** "Where did every lead come from, which campaign generated it, how much revenue did it produce." New `computeChannelPerformance()`/`computeCampaignPerformance()`/`computeMarketingBrief()` in `revenue-intelligence.ts` — lead-scoped (every lead counts, not just proposal-linked ones, unlike the pre-existing `eventSales.revenueByLeadSource`), reusing the same `QUALIFIED_OR_BEYOND` definition `computeFunnel()` already used (hoisted to module scope, not duplicated). Campaign attribution reads migration 026's `leads.campaign`/`utm_source`/`utm_medium` (written by `POST /api/campaigns/track`) via a query deliberately kept SEPARATE and independently error-checked from the core `leads` fetch, so migration 026's still-unverified live status (ENG-034) degrades only campaign attribution, never the rest of the dashboard — verified with a dedicated degraded-path test. Explicitly distinct from `eventSales.revenueByCampaign`, which is OUTBOUND broadcast-campaign attribution (`message_queue`/`broadcast_campaigns`) — kept separate rather than conflated. New Marketing Dashboard (`/dashboard/marketing`, `/api/dashboard/marketing`) composes `buildRevenueIntelligence()` verbatim plus a deterministic (not a real LLM call) AI Marketing Brief, same convention as the Founder Dashboard's AI Morning Brief. No ad-spend tracking exists anywhere in the system, so the ROI Dashboard is explicitly caveated as revenue-per-lead/conversion%, not a fabricated ROI number. Ad-level (individual Facebook/Instagram ad ID) attribution and Google/Email channels remain out of scope — no capture path exists for either yet. Full detail: `docs/sprints/2026-08-01_marketing-intelligence.md`.
- **AI Chief of Staff, Version 3.0 (2026-08-01).** An orchestration layer, not a fourth analytics engine — every number is read from an existing service (Founder Dashboard/Revenue Intelligence/Marketing Intelligence/Opportunity Score/Proposal Intelligence), never recomputed. Extracted the Founder Dashboard route's inline logic into an importable `buildFounderBrief()` (`src/lib/founder/founder-brief-service.ts`) so a second caller could reuse it without duplicating Today's Opportunities/Revenue Pipeline/Today's Schedule/Lost Revenue — `dashboard/founder/route.ts`'s public response is unchanged. New `executive-brief-service.ts` composes: a documented, weight-normalized 8-factor Business Health Score (0-100, each factor read from `revenue-intelligence.ts`; factors with no real data are excluded and disclosed, never fabricated — "Response Time" is deliberately excluded entirely, no aggregate response-time metric exists anywhere in this codebase); Today's Priorities (ranked by each source's own existing urgency number — `lead-intelligence.ts`'s `urgencyScore`, `proposal-intelligence.ts`'s `computeProposalUrgency()` reused verbatim against a new bounded open-proposals query, and follow-ups due); Predictive Insights and Business Risks/Opportunities (each a disclosed read or single arithmetic composition of existing fields, "Insufficient data" wherever a real calculation doesn't exist). Notifications: `notification-producer.ts` is the first-ever writer of the existing (previously dormant, undocumented-schema) `notifications` table — capped per user, never throws, schema uncertainty disclosed via `scripts/verify-notifications-columns.sql`. New `/dashboard/chief-of-staff` + `/api/dashboard/chief-of-staff` — the "never open five dashboards" single view. Full detail: `docs/sprints/2026-08-01_ai-chief-of-staff.md`, `docs/business/AI_CHIEF_OF_STAFF.md`.

**This work sits logically inside Phase 0–1** (it's foundation-usability and verification-discipline work, not a new numbered phase) but was delivered as a separate, dated engagement — recorded here so a future reader doesn't conclude from the phase table alone that none of it has happened.

The single long-horizon roadmap, unifying the existing root `IMPLEMENTATION_ROADMAP.md` (operational/architectural phases) and `docs/growth/20_IMPLEMENTATION_ROADMAP.md` (growth-platform phases) into one sequence. Neither source document is contradicted — this is the merged view, since both share the same Phase 0 dependency.

## Why one merged roadmap

The growth-platform roadmap (`docs/growth/`) explicitly assumes the operational roadmap's foundation work (unified conversation cutover, migration 012 applied) either is complete or runs in parallel. Keeping two separately-maintained roadmaps risks exactly the kind of drift this OS exists to prevent — this document is the one place both should be checked against going forward.

## Phase 0 — Verification & Hygiene (do first, always re-check before relying on "done")

**Business outcome**: Eliminates the single biggest risk to the business today — shipping or relying on features that silently don't work in production (unverified migrations, an unresolved pricing bug that could under-charge or over-charge every reservation). Without this phase, every later phase's "done" claim is unreliable.

From the operational roadmap plus this session's own findings:

- Confirm migration 012/013 apply status directly against the live database (the one-shot verification query already documented in the project's release-readiness material) — do not proceed on assumption.
- Re-verify live schema for `packages`, `reservations`, `reviews`, `analytics_events` against `information_schema.columns` — confirmed drift already found on `packages`.
- Resolve the open reservation-pricing bug (traced through application code without reproduction; the zeroing happens either in the live DB round-trip or a deployed-vs-checkout mismatch) and re-verify against a live database.
- Confirm migration 004 (`broadcast_campaigns`, `festival_calendar`) apply status — flagged in multiple prior sessions as possibly not live, which would mean the Campaigns page 500s in production.
- Get one confirmed, logged `npm run build` pass from a real machine/CI runner — never independently confirmed successful in any sandboxed session on this project.
- Set `CRON_SECRET` and `WHATSAPP_APP_SECRET` in every environment; add both to the standing deployment checklist permanently, not as a one-time item.
- Commit and push all outstanding work from a real git environment — multiple prior sessions produced uncommitted work.
- `.gitattributes` line-ending normalization (stop repo-wide CRLF diff churn).
- Delete confirmed-safe stray files (duplicate migration file, stale `.git.*` backup dirs, dead route file, deprecated `CRMShell.tsx`) — blocked in sandboxed sessions by filesystem permission constraints; do from an environment with real file-delete access.

## Phase 1 — Foundation Usability

**Business outcome**: Operators can self-serve catalog/settings/knowledge-base changes without engineering involvement — mostly already realized per `CHANGELOG.md`; this phase's remaining value is confirming that's still true, not new capability.

- Admin CRUD UI for the hospitality catalog — **already live** per `CHANGELOG.md` (Catalog page, `catalog-service.ts`); verify this is still true rather than re-building.
- Settings backend wired to the `settings` table — **already live** per `CHANGELOG.md`; verify rather than re-build.
- Knowledge Base editor UI over `knowledge_sources`/`ai_prompts` — **already live** per `CHANGELOG.md`.

*(Restated from the original roadmap for completeness — per `CHANGELOG.md`'s 2026-07-22 session, this phase's core items were already built. Verify current state before assuming further work is needed here; this phase's main remaining risk is the schema-drift lesson from Phase 0, not missing features.)*

## Phase 2 — Unified Conversation Cutover

**Business outcome**: One guest, one conversation history, regardless of channel — operators stop needing to check multiple inboxes for the same customer, and every future channel (Phase 4) inherits a single timeline instead of adding another silo.

- WhatsApp + website chat already dual-write into the unified engine. **Remaining work**: parity verification over a real time window, then legacy table (`conversations`, `whatsapp_conversations`) retirement.
- Unified inbox UI consolidating channel-specific pages, per `docs/growth/07_OMNICHANNEL.md`.
- Generalize `queue.ts`'s `smartSend()` into a fully channel-dispatching outbound queue (partially done via `outbound-dispatcher.ts` — verify completeness).

## Phase 3 — AI Depth

**Business outcome**: Higher AI answer quality and lower human-handoff rate, directly moving the `MASTER_PRODUCT.md` Success Metrics for AI-vs-human resolution rate — the vector RAG wiring in particular is named as the single highest-leverage AI-quality improvement available today.

- Wire the existing-but-unused vector RAG path (`match_knowledge_chunks()` RPC) to replace keyword `ilike` retrieval — the single highest-leverage AI-quality improvement available, per `MASTER_AI.md`.
- Surface `operator-assistant.ts` in the Inbox — `docs/growth/06_AI_SALES_ASSISTANT.md`.
- Harden lead auto-extraction across all channels (including once social DMs exist).

## Phase 4 — New Channels

**Business outcome**: Reaches guests where they already are (Instagram/Messenger DM, email, GBP) without adding operator workload, since every new channel reuses the Phase 2 unified timeline and the Integration/Plugin Architecture pattern in `MASTER_ARCHITECTURE.md` rather than becoming a new silo to monitor.

Facebook Messenger + Instagram DM (reuses WhatsApp's Meta Graph/HMAC infrastructure) — **capture + AI response done as of 2026-08-01** (Version 2.0, Omnichannel Communication Platform; see "Shipped since freeze" above) — → email-in adapter (not started) → Google Business Profile (validate API availability first — historically unstable, not started) → LinkedIn where APIs permit (not started).

## Phase 5 — Social Media Command Center v1

**Business outcome**: Reputation and social engagement become manageable from inside the CRM instead of requiring operators to context-switch across native platform apps — directly serves the guest-experience and platform-reach Success Metrics in `MASTER_PRODUCT.md`.

Platform connections + OAuth vault → unified social inbox (comments/mentions/reviews linked to CRM) → AI auto-responder (reuses Phase 3's orchestrator) → review management (aggregate, AI-drafted responses, rating trends). Cross-reference `docs/growth/10_SOCIAL_MEDIA.md`, `11_GOOGLE_BUSINESS.md`, `16_REVIEW_MANAGEMENT.md` for the fully-specified module designs.

## Phase 6 — Growth Platform: Marketing & Retention

**Business outcome**: The transition from "CRM that records bookings" to "growth platform that drives repeat revenue" — segments/campaigns/referral/loyalty are where the revenue Success Metrics (repeat-guest rate, referral-sourced revenue, average booking value) actually start moving, per `docs/growth/`'s own thesis.

This is where the two roadmaps fully merge — everything in `docs/growth/05` through `19` sequences here, in the order that document set's own `20_IMPLEMENTATION_ROADMAP.md` already lays out (segments/attribution scaffolding → campaigns/journeys/social-publish/reviews → referral/loyalty/SEO/AI-recommendations). Do not re-derive this sequencing here — refer to that document, which remains the authoritative growth-platform sequence; this phase entry exists so it has a slot in the single merged timeline.

## Phase 7 — Operations Depth & Distribution

**Business outcome**: Distribution reach (OTA channel manager) and operational efficiency (housekeeping/check-in-out, staff performance, deeper analytics) — the phase that scales the business beyond what one operator's manual attention can cover.

Housekeeping/maintenance/check-in-out flows tied to reservation status transitions · OTA channel manager (Booking.com → Agoda → Google Hotels → Expedia → Airbnb, mapping onto `rate_plans`/`inventory_items`) · analytics depth (cohorts, channel attribution, activate `staff_performance`, finish dormant `ai_summaries` code).

## Standing rules across every phase (repeated because they're the actual governance mechanism, not decoration)

Review before modifying · reuse before building · no duplicate implementations · additive migrations only · human confirmation before destructive actions or public-API breaking changes · update `CHANGELOG.md` and the relevant `MASTER_*` file every phase · every phase exits deployable (build + tsc + lint + tests green).

## Release Gates

Concrete, checkable exit criteria for each phase — the "deployable at every phase end" standing rule above, made specific enough to actually gate a release rather than being asserted informally:

| Phase | Cannot be considered complete until |
|---|---|
| Phase 0 | Every item in the phase is independently confirmed (not presumed) against a live environment; `npm run build`/`tsc --noEmit`/`npm run lint`/`vitest run` all green in a real (non-sandboxed) environment; a `docs/releases/` entry records the verification. |
| Phase 1 | Current-state claims ("already live" per `CHANGELOG.md`) re-confirmed, not just carried forward. |
| Phase 2 | Parity verified between legacy and unified conversation paths over a real time window; legacy tables retired or an explicit, dated decision recorded to keep them longer. |
| Phase 3 | Vector RAG retrieval demonstrably outperforms keyword `ilike` on a real query sample; `operator-assistant.ts` surfaced in the Inbox and used in at least one real session. |
| Phase 4 | Each new channel adapter passes the same idempotency/identity-resolution checks WhatsApp's adapter already passes, verified with real inbound traffic. |
| Phase 5 | Unified social inbox reflects real platform activity (comments/mentions/reviews) for at least one connected account, end to end. |
| Phase 6 | At least one growth-platform module (per `docs/growth/20_IMPLEMENTATION_ROADMAP.md`'s sequencing) is live and generating real segment/campaign data, not just schema. |
| Phase 7 | OTA channel manager reflects a real external booking round-trip (create/cancel) against at least one OTA sandbox/production account. |

A phase can be *started* before the prior phase's gate is fully closed (parallel work is normal), but should not be marked complete in `CHANGELOG.md`/a `docs/releases/` entry until its gate closes — this is the same "presumed vs. confirmed" discipline as `MASTER_DATABASE.md`'s central rule, applied to phases instead of migrations.

## Quarterly Executive View

A compressed view for a business-owner audience who doesn't need the phase-by-phase engineering detail — cross-reference the full phase list above for what each quarter actually contains. Quarters are illustrative sequencing, not committed calendar dates; actual dates belong in a dated `docs/releases/`/`docs/sprints/` entry once the business schedules them:

| Quarter (illustrative) | Engineering focus | What the business should notice |
|---|---|---|
| Q1 | Phase 0–1 | Fewer "presumed done" surprises; existing admin tools confirmed solid. |
| Q2 | Phase 2–3 | One conversation history per guest; noticeably better AI answers, fewer human handoffs. |
| Q3 | Phase 4–5 | Guests reachable on more channels; social/reviews visible from one place. |
| Q4+ | Phase 6–7 | Marketing/retention features start driving repeat bookings; OTA distribution and ops depth extend reach and efficiency. |

This view should be regenerated (not hand-maintained separately) whenever the phase list or Business Outcomes above change — it is a derived summary, and letting it drift from the phase detail would recreate exactly the two-roadmap drift risk this document was created to eliminate.

## Explicit non-goals for the 3–5 year horizon (recorded, not guessed)

Multi-tenant SaaS, a public self-service booking engine, and any redesign of the "human approval before customer-facing sends" rule are all treated as out of scope unless a specific, deliberate product decision changes `MASTER_PRODUCT.md` first. This roadmap does not assume any of them are coming.
