# Revenue Conversion, Founder Dashboard, AI Policy & RC2 Hardening — 2026-08-01

One consolidated record covering several dated engagements on `release/v1.0.0-rc2`, written retroactively at RC2 Final / Release Preparation time because `docs/sprints/` and `docs/releases/` existed as a convention (see their own `README.md`) but had zero actual entries until now — this is the first sprint record either directory has ever received. Consolidated into one file rather than six, since all of it shipped as one continuous engagement with no gap for a separate record to have been written at the time.

## Scope

Implement, in order: Sprint 1.5 (AI Sales Executive site-visit scheduling, small completion of already-in-progress work), Sprint 2 (Revenue Conversion Engine — convert completed Site Visits into Proposal Opportunities), Sprint 3A (Founder Dashboard, two passes — initial build then an Implementation Mode revision), the AI Hospitality Sales Consultant Policy (merged into the live system prompt + Business Knowledge Base), RC2 real-business validation across 8 customer journeys, and RC2 Phase 2 production-database verification. Each was scoped by an explicit "reuse existing implementation, do not redesign, do not duplicate" mandate — see `docs/engineering/MASTER_ROADMAP.md`'s "Shipped since freeze" addendum for the one-paragraph summary and cross-references into this file.

## What shipped

- **`src/lib/ai/opportunity-score.ts`** — extended with `hasCompletedVisit`/`hasViewedProposal` signals, weights rebalanced (7 components summing to 100).
- **`src/lib/leads/auto-package-recommendation.ts`** — added the Property Intelligence hard guard (Skyline-never-events, Monurama-100-cap), shared by every caller.
- **`src/lib/leads/visit-to-proposal.ts`** (new) — the Sprint 2 trigger: completed Site Visit → safe-fill lead fields → `runAutoPackageRecommendation`.
- **`src/app/api/site-visits/[id]/route.ts`** — `PATCH` now calls the above on `status: 'completed'`.
- **`src/lib/leads/lead-intelligence.ts`** (new) — extracted from `HotLeadDashboard.tsx` so the Founder Dashboard's server route could reuse the same next-action logic instead of reimplementing it.
- **`src/lib/analytics/revenue-intelligence.ts`** — extended with `computePipelineBreakdown()`/`computeLostRevenue()`, both reusing the file's own already-fetched raw data (no second aggregation layer).
- **`src/app/api/dashboard/founder/route.ts`** + **`src/app/(crm)/dashboard/founder/page.tsx`** (new) — Today's Opportunities / Revenue Pipeline / Today's Schedule (one merged timeline) / AI Morning Brief / Lost Revenue Summary.
- **`src/lib/ai.ts`** (`SYSTEM_PROMPT`) — merged in the AI Hospitality Sales Consultant Policy (success metrics, decision framework, site-visit philosophy, founder principle, expanded escalation triggers) as a condensed excerpt of the canonical version now in `docs/business/07_AI_BEHAVIOR_RULES.md`.
- **`src/app/api/chat/route.ts`** — one new call: `runAutoPackageRecommendation()` now fires from the AI chat widget's lead-upsert path (previously only the website form/WhatsApp/social had this — closes the "customer wants a proposal immediately via chat" gap found during RC2 journey validation).
- **Tests:** `opportunity-score.test.ts`, `visit-to-proposal.test.ts`, `auto-package-recommendation.test.ts` (guard-specific), `lead-intelligence.test.ts`, `revenue-intelligence.test.ts` (pipeline/lost-revenue), `rc2-journey-validation.integration.test.ts` (10 tests, chains real functions across all 8 required customer journeys), `lead-has-scheduled-visit.test.ts` (3 tests, closed a real coverage gap). Final count: 50 test files / 464 tests, up from 396 at the start of this arc.
- **Documentation:** `docs/business/07_AI_BEHAVIOR_RULES.md` (AI Hospitality Sales Consultant Policy section, resolving a previously-open founder-input-required placeholder), `docs/business/09_VISIT_MANAGEMENT.md` (corrected from "not yet built" to reflect the shipped Sprint 1/2 feature), `docs/business/10_BUSINESS_RULES.md` (2 new index rows), `docs/engineering/MASTER_BACKLOG.md` (ENG-033/034/035), `docs/engineering/MASTER_DATABASE.md` (migrations 026/027 added to inventory, `packages`-drift verification pointer), `RC2_READINESS_REPORT.md`, `PRODUCTION_VERIFICATION_REPORT.md` (+ same-day addendum correcting its own Package/Pricing grade).

## What was verified vs. assumed

**Directly verified, this arc:** `tsc --noEmit` clean at every commit; full `vitest run` green throughout (396 → 429 → 445 → 451 → 464 tests, zero regressions at any step); `next build` succeeded with a full clean completion at least once per major change (compiled + linted + typechecked every attempt, occasionally hit the sandbox's tool-timeout during static generation — a known, previously-documented hazard, not a code defect); byte-parity rsync verification before trusting any sandbox test run, per this project's standing sandbox discipline.

**Explicitly assumed, not verified (stated plainly, not left silent):** every claim about production database state. This sandbox has no network route to the production Supabase project — confirmed this arc with a captured, reproducible error (`403 blocked-by-allowlist` from the sandbox's own outbound proxy), stronger evidence than prior sessions' DNS-timeout-based conclusion. Migrations 026 and 027's live status, and the `packages` column-naming drift's current status, are all **Unknown**, not Verified — see `PRODUCTION_VERIFICATION_REPORT.md`.

## Issues found

- **BUG (found and fixed, this arc):** the AI chat widget never triggered automatic Package Recommendation, unlike every other lead-capture channel — a customer asking Aria for "a proposal now" got nothing automatic. Fixed with one new call site to the existing, self-gated `runAutoPackageRecommendation()`. See `rc2-journey-validation.integration.test.ts`, Journey 6.
- **ENG-033** (Critical, new) — migration 027 (`follow_ups` site-visit columns) never verified against production; a hard-failure dependency of everything in this record's "What shipped" related to Site Visits.
- **ENG-034** (Medium, new) — migration 026 (`leads` campaign-attribution columns) never verified.
- **ENG-035** (Critical, new) — `packages.venue`/`base_price`/`max_guests` may not exist live under those names (a confirmed RC1-session finding, previously under-weighted); if so, the Property Intelligence guards built this arc are silently inert and proposal pricing computes near ₹0.

## Remaining / follow-up

Run `scripts/verify-packages-columns.sql` and `scripts/verify-migrations-026-027.sql` against production before this release is trusted — see `PRODUCTION_VERIFICATION_REPORT.md` §6 for full sequencing. No feature work is queued from this arc; the next engagement (RC2 Final / Release Preparation, same day) is documentation/release-packaging only, per its own explicit "no feature development" mandate.
