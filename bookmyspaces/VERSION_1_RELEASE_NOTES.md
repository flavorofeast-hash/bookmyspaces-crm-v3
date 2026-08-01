# BookMySpaces CRM — Version 1.0 Release Notes

Written 2026-08-01, packaging `release/v1.0.0-rc2` (package.json already reads `1.0.0`). This document is the release package: what v1.0 does, how it's built, what it can't do yet, and how to deploy and roll it back. It draws on and does not duplicate `docs/engineering/` (Engineering OS), `docs/business/` (Business Knowledge Base), `RC2_READINESS_REPORT.md`, and `PRODUCTION_VERIFICATION_REPORT.md` — read those for the underlying evidence; this document is the summary a founder, a new engineer, or a deploying operator should read first.

---

## Major Features

**AI-first omnichannel intake.** Website chat, WhatsApp (Meta Cloud API), and Facebook/Instagram Lead Ads + Messenger + DM all resolve to one customer identity and one conversation timeline. The AI (Aria) qualifies leads conversationally, extracts structured data (name/phone/email/event type/date/guest count/budget/venue) into the CRM automatically, and operates under the AI Hospitality Sales Consultant Policy (`docs/business/07_AI_BEHAVIOR_RULES.md`) — measured by trust and conversion, not by message count.

**Direct Event Sales Engine.** The AI Event Sales Advisor recommends a package from live inventory and auto-drafts a proposal once a lead is qualified — enforced everywhere by a code-level Property Intelligence guard: Skyline Serenity is never recommended for weddings/birthdays/corporate events (accommodation-only), and Monurama Homestay proposals are refused above its 100-guest property-wide cap.

**Site Visit Scheduling → Revenue Conversion Engine (new this release).** A customer can ask the AI to schedule a site visit conversationally; the AI captures date + time and books it via the same mechanism the CRM's `/visits/new` staff form uses, guarded against duplicate bookings. Marking a visit "Completed" automatically triggers the same Package Recommendation → Proposal Draft pipeline as lead qualification — pre-filling the lead's guest count/budget/venue from what was captured at the visit (never overwriting existing data). One pipeline: **Site Visit → Proposal Draft → Owner Review → Ready to Send.**

**Founder Dashboard (new this release).** Five sections answering "what should I do today": Today's Opportunities (with Revenue Probability and Next Action per lead), Revenue Pipeline (Leads → Visits → Draft Proposals → Sent → Negotiation → Bookings), Today's Schedule (one merged timeline of visits/follow-ups/proposal reviews), AI Morning Brief (deterministic, not another AI call where the numbers already exist), and Lost Revenue Summary (honest about what it can and can't explain — see Known Limitations).

**Reservation Platform.** Rooms, halls, meal plans, add-on services, an availability engine, invoicing, and taxes — architecturally complete; see Known Limitations for its production-readiness caveat.

**Revenue Intelligence.** Sales funnel, revenue forecast, proposal/booking/customer analytics, sales productivity, event revenue by hall/venue/package/lead-source/campaign — all computed from one shared, bulk-fetched dataset (`revenue-intelligence.ts`), not scattered per-page queries.

**Customer Journey Automation, Campaign Scheduler, Operator Tooling.** 9-stage lifecycle automation, queue-based campaign sends with recurrence and segmentation, Kanban lead pipeline, unified inbox with AI-assisted replies, audit logging.

---

## Architecture

Next.js 14 (App Router) on Vercel, Supabase (Postgres + Auth + Storage) as the sole datastore, Anthropic Claude as the primary AI provider with an OpenAI fallback for chat and embeddings for RAG. No new architectural layer was introduced this release — every feature above reuses the existing service/route/component pattern documented in `docs/engineering/MASTER_ARCHITECTURE.md`.

**Standing principles, reconfirmed this release:** every AI-drafted artifact (proposal, cover note, upsell suggestion) requires human approval before anything customer-facing is sent — `status: 'draft'` is the universal "needs review" state, no new status was introduced. Bulk-fetch-then-reduce-in-memory over per-row queries (the "no N+1" posture) — with one disclosed exception this release: the Founder Dashboard's per-lead Opportunity Score fanout, explicitly bounded to 12 candidates. Additive-only migrations with paired rollback files, reuse-over-rebuild enforced at every sprint boundary this release (see `docs/sprints/2026-08-01_revenue-conversion-and-rc2-hardening.md` for the specific reuse decisions made).

**Data model, this release's additions:** no new tables. Migration 027 extends the existing `follow_ups` table (already had a `site_visit` type value since migration 007, simply unused until now) with `property`/`purpose`/`guest_count`/`budget`. Everything else — Opportunity Score, Revenue Pipeline, Lost Revenue, Founder Dashboard — reads `leads`/`proposals`/`follow_ups` that already existed.

---

## AI Capabilities

- Conversational lead qualification and structured-data extraction, grounded in a knowledge base (`knowledge_chunks`/`knowledge_sources`), with a documented fallback (Claude → OpenAI) if the primary provider errors.
- Event Sales Advisor: package recommendation with a **code-enforced** (not just prompt-enforced) Property Intelligence guard.
- Site visit scheduling embedded in natural conversation — never proposed unprompted (AI Hospitality Sales Consultant Policy).
- Revenue Probability scoring (`opportunity-score.ts`) — deterministic, DB-driven, 0–100, seven weighted components including site-visit and proposal-engagement signals added this release.
- Operator-assist tools (suggest/rewrite/translate/tone) in the Inbox.
- Human escalation on: explicit request, blocked business rule, requested exception/pricing, trust-affecting uncertainty, or low AI confidence — implemented in `checkAndApplyHandoff` (Phase 4 orchestrator), and the live system prompt was updated this release to describe these same triggers consistently to the customer.

---

## Business Capabilities

Everything in `docs/business/` (the Business Knowledge Base) is now the canonical source for property intelligence, packages, pricing rules, discount policy, sales/marketing playbooks, AI behavior policy, standard responses, visit management, and the master business-rule index — 10 files, all committed to git for the first time this release (previously existed only on disk). The AI Hospitality Sales Consultant Policy is the newest addition: success metrics, decision framework, site-visit philosophy, founder principle, and escalation triggers, implemented as both a condensed excerpt in the live `SYSTEM_PROMPT` and the full canonical version in `07_AI_BEHAVIOR_RULES.md` — single source of truth, no parallel prompt files.

---

## Known Limitations

Carried forward honestly, not omitted:

- **Reservation Platform is not confirmed live in production.** Migrations 012/013 (the tables `reservation-service.ts`/`availability-service.ts` depend on) are confirmed **not applied** to production, re-verified across 8+ engineering sessions. Every reservation-creating code path will 502 or show an all-zero dashboard until this is resolved. **Do not enable guest-facing reservation booking until ENG-001 is closed.**
- **Site Visit Scheduling's own migration (027) has never been checked against production.** Unlike a `SELECT *` query, `scheduleSiteVisit()` inserts named columns — if 027 isn't live, every visit request hard-fails. **Run `scripts/verify-migrations-026-027.sql` before this feature is trusted live** (ENG-033).
- **A previously-documented `packages` table schema drift may make the Property Intelligence guards silently inert and zero out proposal pricing.** Found in an earlier RC1 session, under-weighted until this release's verification pass corrected it. **This is the single highest-priority pre-launch check in this entire release** — run `scripts/verify-packages-columns.sql` first (ENG-035).
- **Reservation pricing has an unresolved zeroing bug** (ENG-004), blocked on the two items above being resolved first.
- **Room-stay/airport-stay enquiries** don't get an automatic reservation quote from an AI chat conversation — that flow is staff-initiated only today. Not a regression; a pre-existing, documented gap outside this release's scope.
- **Lost Revenue Summary's reason breakdown** (No Response / Price / Capacity / Other) has no underlying data column to compute from — the dashboard says "Insufficient data" honestly rather than inventing numbers. Only "No Follow-up" is real, derived from `leads.follow_up_count`.
- **No live LLM calls or live Supabase connection were available during this release's own validation** — AI conversational behavior (exact phrasing) was verified by prompt inspection, not execution; all "production schema" claims are evidence-graded, not asserted as fact.
- Standing, unresolved from RC1: migration 004 (Campaigns tables) apply status unconfirmed (ENG-002); no confirmed `npm run build` pass from a real CI/production runner, only this project's sandbox (ENG-005); `CRON_SECRET`/`WHATSAPP_APP_SECRET` must be set in every environment before launch (ENG-006/007).

---

## Deployment Steps

Full detail: `GO_LIVE_CHECKLIST.md`. Summary sequence:

1. **Resolve the two Critical, release-blocking unknowns first**: run `scripts/verify-packages-columns.sql`, then `scripts/verify-migrations-026-027.sql`, against production via the Supabase SQL Editor. Both are read-only.
2. Apply any migration the checks above show missing (all additive, idempotent, paired-rollback) — `026`/`027` at minimum; `012`/`013`/`016`/`017`/`023`/`024` per `PRODUCTION_MIGRATION_STATE_VERIFICATION.md`'s recommended sequence if the Reservation Platform is in scope for this launch.
3. Set every environment variable in `ENVIRONMENT_VARIABLES.md`, with `CRON_SECRET` and `WHATSAPP_APP_SECRET` treated as launch-blocking, not optional.
4. Deploy to Vercel (`main` or the target production branch/environment).
5. Run the smoke tests in `GO_LIVE_CHECKLIST.md` against the live deployment.
6. Write a `docs/releases/` entry recording what was actually deployed and verified, per that directory's standing convention.

---

## Rollback Strategy

**Application code:** promote the previous Vercel deployment, or `git revert` the specific commits on `release/v1.0.0-rc2` (see `docs/sprints/2026-08-01_revenue-conversion-and-rc2-hardening.md` for the commit list). No feature in this release depends on a destructive migration, so an application-code rollback alone is safe and sufficient in the common case.

**Migrations:** every migration this release touches (026, 027) has a paired `_ROLLBACK.sql` file (`DROP COLUMN IF EXISTS`, safe to run, but any data written into those columns is permanently lost — the standard trade-off documented in `MASTER_DATABASE.md`'s Database Evolution Policy). Run the rollback file directly via the Supabase SQL Editor only if the forward migration itself is the problem, not the application code built on top of it.

**Database backup:** confirm Supabase's automatic backup is current (or take a manual one) before applying any migration — standing recommendation, unchanged from RC1.

---

## Future Roadmap

See `docs/engineering/MASTER_ROADMAP.md` (Phases 0–7) for the full, standing roadmap and its "Shipped since freeze" addendum for exactly what this release adds against it. Near-term priorities, in order: close ENG-035/ENG-033 (this release's two new Critical unknowns), close ENG-001/003/004 (the standing Reservation Platform + pricing-bug blockers), then Phase 2 (Unified Conversation Cutover completion) and Phase 3 (vector RAG retrieval, the single highest-leverage AI-quality improvement identified in `MASTER_AI.md`). The Growth Platform phases (`docs/growth/`, marketing/retention/loyalty/referral) remain sequenced but not started.
