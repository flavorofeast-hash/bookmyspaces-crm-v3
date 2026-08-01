# AI Chief of Staff, Version 3.0 — 2026-08-01

## Scope

Mission: transform BookMySpaces from "an AI-powered CRM" into "an AI-powered Hospitality Business Operating System" by building an AI Chief of Staff — explicitly **not** another dashboard, analytics engine, or reporting module, but an orchestration layer (Observe → Analyze → Prioritize → Recommend → Notify) over every existing BookMySpaces service. Mandatory first step: produce a dependency map of every existing dashboard/reporting/analytics/AI/scoring/orchestration service before writing any code.

## Dependency map (investigation before any code)

Delegated a codebase-wide read-only survey (Founder Dashboard, Revenue Intelligence, Marketing Dashboard, Opportunity Score, Lead Intelligence, Proposal Engine, Timeline, Unified Inbox, Follow-up handling, AI orchestrator/escalation, notification system, Engineering OS, Business KB). Confirmed findings, each verified by reading the actual code (not assumed):

- Every "Chief of Staff" concept the mission lists already has an owning existing function — see the table in `docs/business/AI_CHIEF_OF_STAFF.md`'s Data Sources section. Nothing needed a new calculation engine.
- **Proposal Engine** — `src/lib/proposal-intelligence.ts`'s `computeProposalUrgency()` (pure, already used by `/api/proposals/intelligence`) is the exact "is this proposal at risk, what should we do" engine the mission's "Proposal viewed 5 times, no reply" example describes. `proposals.viewed_count`/`last_viewed_at` (migration 010) are real, confirmed columns — nothing here needed to be invented.
- **Notifications** — `notifications` table + `/api/notifications` (GET/PATCH) exist and are a real, working, owner-scoped-RLS API, but a repo-wide search found **zero producers anywhere** — nothing in this codebase, including escalations and lost-revenue, has ever inserted a row. Confirmed genuinely dormant, not half-built.
- **Business Health Score** — nothing like it exists anywhere. Composing one from existing sub-metrics is legitimate new orchestration, not duplication, provided every input is an existing computed field (it is — see formula below).
- **No "morning brief for founder"/"executive brief" naming collision** — grep found nothing outside the Founder Dashboard's own template-string `morningBrief` field, scoped to five founder-dashboard sections only.

## What shipped

- **`src/lib/founder/founder-brief-service.ts`** (new) — `buildFounderBrief()`, extracted UNCHANGED from `dashboard/founder/route.ts`'s previously-inline GET handler logic (Today's Opportunities ranking, Revenue Pipeline, Today's Schedule, Morning Brief, Lost Revenue Summary), so the Chief of Staff (a second real caller) reuses it instead of re-deriving a competing computation. `dashboard/founder/route.ts` is now a thin handler calling this service and returning the exact same JSON shape as before — zero behavior change for the existing Founder Dashboard page. One additive field: `Opportunity.urgencyScore` (previously computed by `lead-intelligence.ts` and discarded) is now exposed so Today's Priorities can rank by it.
- **`src/lib/chief-of-staff/executive-brief-service.ts`** (new) — the orchestration layer itself:
  - `computeBusinessHealthScore()` — documented, weight-normalized 8-factor composite (see Business Health Formula below), reading only existing `revenue-intelligence.ts` fields.
  - `computeTodaysPriorities()` — merges and ranks three existing-signal sources (opportunity-score-ranked leads, `computeProposalUrgency()`-flagged open proposals, follow-ups due) by each source's own pre-existing urgency number.
  - `computePredictiveInsights()` — Expected Revenue, Revenue at Risk, Likely Bookings, High-value/Dormant Customers, Campaigns/Packages Likely to Perform — each a direct read or single disclosed arithmetic composition of existing fields, "Insufficient data" wherever a real calculation doesn't exist (never fabricated).
  - `computeAIRecommendations()` — deterministic, template-grounded (not a real LLM call, same convention as the existing AI Morning Brief/AI Marketing Brief), always names a real customer/proposal/campaign/package.
  - `computeBusinessRisks()`/`computeBusinessOpportunities()` — threshold-based, grounded in real numbers; legitimately empty lists when nothing crosses a threshold.
  - Two disclosed new queries (open proposals with lead context for `computeProposalUrgency()`; founder-tier `user_profiles` for notifications) — neither duplicates an existing service, since none already returns these shapes.
- **`src/lib/chief-of-staff/notification-producer.ts`** (new) — first-ever writer of the existing `notifications` table. Four meaningful-event types (high-value lead, proposal viewed multiple times, revenue trending down, capacity near-full), capped at 5 unread notifications per user ("do not spam," enforced using only confirmed table columns), every insert wrapped in try/catch and logged, never fatal to the Executive Brief. Schema uncertainty (the table isn't defined in any migration) explicitly disclosed in the file header and in `scripts/verify-notifications-columns.sql`.
- **`src/app/api/dashboard/chief-of-staff/route.ts`** (new) — composes `buildExecutiveBrief()` verbatim; runs notifications after the brief and never lets a notification failure fail the route.
- **`src/app/(crm)/dashboard/chief-of-staff/page.tsx`** (new) — the "never open five dashboards" single view: Business Health Score + breakdown, AI Recommendations, Today's Priorities, Business Risks/Opportunities, Predictive Insights, Business Summaries (8 one-liners), Conversion Funnel. Added to `CRMLayout.tsx`'s nav, placed first.
- **`docs/business/AI_CHIEF_OF_STAFF.md`** (new) — Purpose, Architecture, Data Sources (full dependency-map table), Business Rules, Decision Logic, Recommendation Logic, Business Health Formula, Limitations, Future Scope.
- **`scripts/verify-notifications-columns.sql`** (new) — read-only schema check for the notifications table.
- **Tests (27 new, 511 total, 0 regressions):**
  - `executive-brief-service.test.ts` (22 tests) — every exported compute function tested directly against hand-built fixtures (all are pure functions, no DB mocking needed): Business Health Score's weight re-normalization and "Response Time never included" guarantee, Today's Priorities' ranking/dedup/limit behavior, Predictive Insights' division-by-zero and low-volume-campaign guards, Recommendations' "always specific, never generic" and dedup guarantees, Risks/Opportunities' "empty list when nothing qualifies, not a fabricated entry" guarantee, Summaries' degraded-booking-data disclosure.
  - `notification-producer.test.ts` (5 tests) — writes on a real meaningful event, writes nothing when there's nothing to report, respects the spam cap, never throws on an insert failure (simulating the exact "assumed column doesn't exist" risk), never throws on an audience-lookup failure.

## What was verified vs. assumed

**Directly verified:** `tsc --noEmit` clean at every stage; full `vitest run` green (511/511, 55 files); `next build`'s compile + type-check + lint phase succeeded cleanly across four separate attempts (zero errors, only the pre-existing unrelated `<img>` warning).

**Not fully verified this session — disclosed, not hidden:** `next build`'s static-page-generation phase did not complete within this sandbox's 45-second per-command cap across four consecutive attempts (a previously-documented hazard in this project's own session history, `ENG-005`). Since compile/type-check/lint — the phase that would surface a real error in this session's new code — succeeded cleanly every time, and the new pages are client-rendered (`'use client'`, runtime fetch) rather than statically pre-rendered with build-time data fetching, this is assessed as the known sandbox timing limitation rather than a defect, but a real CI/production build pass (per `ENG-005`) should still confirm this before relying on it in production.
**Also unverified (inherited, not new):** the `notifications` table's real column names beyond the six confirmed by existing code — `scripts/verify-notifications-columns.sql` must be run before trusting notification writes in production.

## Issues found

None new — no defect was found in any existing shipped service during the dependency-map investigation. The one real design decision made mid-build (see `executive-brief-service.ts`'s header) was to fetch migration-026-style campaign/UTM data — no, that was Version 2.1; for this sprint the equivalent decision was to fetch open-proposal-with-lead-context via a new, disclosed, bounded query rather than trusting the `proposals.urgency_score` persisted column, which is only updated by a manual PATCH call and can be stale.

## Remaining / follow-up

- Confirm `notifications` table's real schema in production (`scripts/verify-notifications-columns.sql`) before relying on Chief of Staff notifications.
- Get a real CI/machine `next build` pass confirming full static-generation completion (`ENG-005`, pre-existing, not new to this sprint).
- Business Health Score's "Response Time" factor remains genuinely absent — building it would require a new, separately-owned aggregation service, which this orchestration-only sprint deliberately did not create.
- A scheduled daily run of the Executive Brief (auto-generated each morning rather than requiring the Founder to open the page) is a natural next step, using this platform's existing scheduling capability.
