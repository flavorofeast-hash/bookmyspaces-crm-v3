# 19 — AI Recommendations (beyond package matching)

## Business Objective

`runEventSalesAdvisor()` and `auto-package-recommendation.ts` already prove the pattern (structured recommendation from CRM data, human-approved, logged, success-rate-tracked). This module generalizes that pattern to the growth-specific recommendations named throughout this document set — churn-risk flags, next-best-offer, content topics, campaign timing — as one coherent "AI Recommendations" surface rather than each module inventing its own bespoke suggestion mechanism.

## User Journey

An operator sees, in one place (likely a widget on the main Dashboard, given this product's single-operator scale doesn't justify a separate "Recommendations" page), a short list: "Ananya S. hasn't booked in 95 days — send a win-back message," "The Sunset Rooftop Party package is trending for August — consider a targeted campaign," "3 recent reviews mention slow check-in — worth investigating." Each recommendation traces to real data and links to the action that addresses it.

## Existing Code Reuse

- `src/lib/leads/auto-package-recommendation.ts` and `runEventSalesAdvisor()` (`operator-assistant.ts`) — the exact structured-recommendation-with-confidence-and-logging pattern this module generalizes.
- `ai_interaction_log` — already the logging destination for AI recommendations; this module's new recommendation types extend the existing `interaction_type` CHECK constraint additively (the same additive pattern migration 024 already used to add `event_sales_advisor`/`upsell_recommendations`), not a new log table.
- Revenue Intelligence's "AI Recommendation Success Rate" metric (`revenue-intelligence.ts`) — already computes recommendation-to-accepted-proposal success rate for package recommendations; this module's new recommendation types are designed to be measurable by the same kind of closed-loop comparison, not exempt from measurement.
- `lifetime-value.ts` (churn-risk needs "time since last stay" per customer — already computable from data this file already touches), `interaction-service.ts`'s sentiment classification (review-theme flagging).

## Required Database Changes

None beyond the additive CHECK-constraint extensions on `ai_interaction_log.interaction_type` for each new recommendation type (churn_risk, content_topic, campaign_timing, etc.) — same pattern as existing types, no new tables.

## Required APIs

- `GET /api/ai/recommendations` — aggregates across whatever recommendation-generating jobs/functions exist (churn scan, package-trend scan, review-theme scan), returns a unified list. Individual recommendation generation likely runs as scheduled jobs (`/api/cron/ai-recommendations`, new) rather than on-demand, given these are pattern-detection tasks over historical data, not per-request computations.

## UI Changes

- Dashboard widget (or a dedicated lightweight section on the main Dashboard page) — a flat, actionable list, not a new complex page, matching this product's existing dashboard conventions.

## AI Opportunities

- This module *is* the AI-opportunities module — its own opportunity is doing this well: keeping every recommendation type traceable to real data (no fabricated confidence), measurable (feeding the same success-rate pattern already proven), and actionable (one click to the relevant module — send campaign, view review, open customer profile) rather than a passive insights feed nobody acts on.

## Risks

- Recommendation fatigue: if this surfaces too many low-value suggestions, operators will stop reading it, the same failure mode any CRM "insights" feed risks. Recommend a hard cap (e.g., top 5, ranked by estimated revenue impact) rather than an unbounded list.
- Every recommendation type here depends on the module it's recommending action for (churn-risk depends on `08`/`14`'s definitions, campaign-timing depends on `09`/`18`'s attribution data) — this module should be built last among the growth modules, not first, despite "AI recommendations" sounding foundational.

## Dependencies

- `08_CUSTOMER_JOURNEY.md`, `09_CAMPAIGN_ENGINE.md`, `16_REVIEW_MANAGEMENT.md`, `18_ANALYTICS.md` — this module is a consumer of all of them.

## Development Priority

**P3, deliberately last** — highest ceiling for "impressive demo," but genuinely needs the other modules' data (attribution, journey state, review themes) to exist first to be more than a novelty.
