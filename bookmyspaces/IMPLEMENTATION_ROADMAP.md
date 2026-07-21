# BOOKMYSPACES V3 — IMPLEMENTATION ROADMAP

Last updated: 2026-07-21. Supersedes `audit/IMPLEMENTATION_ROADMAP.md` (remediation-era, complete) as the forward plan; absorbs `audit/VERSION1_1_ROADMAP.md` tiers. Every phase exits deployable: build + tsc + lint + vitest green, docs + CHANGELOG updated, clean commits.

## Phase 0 — Hygiene & Safety Net (small, do first)
- Push PII-purged rewritten git history to origin (manual, credentialed machine — commands in `audit/IMPLEMENTATION_LOG.md` ISS-025); other clones re-clone.
- Add `.gitattributes` (eol normalization) to stop repo-wide CRLF diff churn; commit normalization once, cleanly.
- Delete stray files: root `007_missing_tables.sql`, `.git.stale-*` / `.git.corrupted-*` dirs, `BOOKMYSPACES_BACKUP` review, `probe_delete_test.txt`, empty api dirs, `files.zip` (all confirmed safe in audit).
- Error tracking (Sentry or equivalent) — highest safety-per-effort item.
- Edge rate limiting on public routes (`/api/chat`, proposal preview/share, WhatsApp webhook).
- `admin_audit_log` table (small additive migration) + refund workflow (`payment_type` CHECK + Refund UI affordance).
- Confirm migrations 009/012/013 are applied to the live DB (live DB is source of truth — verify, don't assume).

## Phase 1 — Make the Foundation Usable
- Admin CRUD UI: properties, inventory_items, rate plans, seasonal pricing, meal plans, add-on services, packages. (Biggest day-to-day friction; currently raw SQL.)
- Wire Settings page to the `settings` table (kill localStorage persistence); include AI confidence threshold, handoff rules, channel toggles.
- Knowledge Base editor UI over `knowledge_sources` (+ ai_prompts versioned editor). Migrate hardcoded `SYSTEM_PROMPT` pricing/property facts into it.

## Phase 2 — Unified Conversation Cutover (the architectural keystone)
- Wrap WhatsApp inbound + website chat as the first two Channel Adapters feeding `unified-conversation-service` (dual-write with legacy tables; parity-verify; then retire legacy paths).
- Replace website chat's inline dedup with `resolve-identity`.
- Unified inbox UI (one conversation list, per-customer timeline via timeline-service).
- Generalize `queue.ts` smartSend into channel-dispatching outbound queue.
- Exit: one customer, one timeline, zero duplicate conversations across both live channels.

## Phase 3 — AI Depth
- Ground all AI responses in `knowledge_sources`: wire the existing-but-unused vector path (`match_knowledge_chunks()` RPC + ivfflat index) to replace keyword `ilike` retrieval.
- AI orchestrator: confidence scoring → configurable human-handoff triggers (request/complaint/refund/payment/VIP/threshold) with full-history + AI-summary handoff payload; AI resumable.
- Agent console: surface `operator-assistant.ts` (suggested replies, rewrite, translate, tone, upsell, next-best-action) in the unified inbox.
- Lead auto-extraction hardened across channels; proposal automation prompts (generate/send proposal, brochure, site visit, follow-up) with human approval gate.
- AI memory: context-builder pulls prior conversations/bookings/proposals/preferences; never re-ask known info.

## Phase 4 — New Channels (adapters only, no core changes)
Order by leverage: 1) Facebook Messenger + Instagram DM (same Meta Graph infrastructure as WhatsApp — HMAC, webhook patterns reuse), 2) Email-in adapter (Resend inbound / IMAP), 3) Google Business Profile messaging (validate current API availability first), 4) LinkedIn where APIs permit.

## Phase 5 — Social Media Command Center v1 (see SOCIAL_MEDIA_ARCHITECTURE.md)
- Platform connections + OAuth token vault (FB, IG, GBP first).
- Unified social inbox: comments, mentions, story/post replies → `social_interactions`, linked to CRM customers where resolvable; DMs ride Phase 4 adapters.
- AI auto-responder with sentiment + escalation (reuses Phase 3 orchestrator).
- Review management: aggregate Google/Facebook reviews, AI-drafted responses (human-approved), rating trends.

## Phase 6 — Content & Marketing
- Content studio (AI captions/hashtags/SEO) + content calendar + scheduler/publisher across connected platforms.
- Campaign manager with AI recommendations; social analytics (reach, engagement, leads, bookings, revenue attribution, best times); social listening alerts.
- Marketing automation: email + WhatsApp campaigns unified; ads integrations (Meta, Google, LinkedIn) tracked click-to-booking.

## Phase 7 — Operations Depth & Distribution
- Housekeeping (status tied to reservation transitions), maintenance tracking, check-in/check-out flows, occupancy dashboard.
- OTA channel manager layer (Booking.com → Agoda → Google Hotels → Expedia → Airbnb) mapping OTA calendars onto rate_plans/inventory_items.
- Analytics depth: cohorts, channel attribution, staff performance (dormant `staff_performance` table), automated AI daily summaries (finish dormant `ai_summaries` code).

## Standing Rules
Review before modifying · reuse before building · no duplicate implementations · additive migrations only · human confirmation before destructive actions or public-API breaking changes · update `CHANGELOG.md` + affected master docs every phase.
