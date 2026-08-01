# Marketing Intelligence Platform, Version 2.1 — 2026-08-01

## Scope

Mission: "BookMySpaces already captures enquiries from multiple channels; now transform those enquiries into measurable business intelligence." Founder should know where every lead came from, which campaign generated it, which platform converted it, how much revenue it produced, which advertisement should get more budget. Implementation Mode — reuse Revenue Intelligence/Founder Dashboard/Opportunity Score/CRM/Unified Inbox/Timeline/Proposal Engine/Booking Pipeline, no duplicate calculations.

## What was found (investigation before any code)

`revenue-intelligence.ts`'s existing `EventSalesDashboard` already computed `revenueByLeadSource`/`revenueByCampaign` via `groupProposalRevenue()`. Two real gaps, confirmed by reading the code rather than assumed:

1. **Proposal-scoped, not lead-scoped.** `groupProposalRevenue()` iterates `data.proposals` only — a channel with leads but zero proposals yet is invisible to it. The mission needs per-channel Leads and Qualified Leads counts, which requires iterating `data.leads`.
2. **`revenueByCampaign` is a different concept.** It's OUTBOUND broadcast-campaign attribution — keyed via `message_queue.metadata.campaign_id` joined to `broadcast_campaigns`, first-touch, tracking which WhatsApp/email broadcast a lead responded to. The mission needs INBOUND ad/landing-page campaign attribution — which Facebook/Instagram ad or landing page a lead originated from. Confirmed `POST /api/campaigns/track/route.ts` actively writes `leads.campaign`/`landing_page`/`utm_source`/`utm_medium`/`utm_campaign`/`referral` (migration 026) for exactly this purpose. Conflating the two would have produced a dashboard that looks like campaign attribution but silently measures the wrong thing.

Also confirmed, and disclosed rather than worked around: individual ad-ID-level attribution (which specific Facebook/Instagram ad, not just which campaign) is not structurally stored anywhere — only present as free text inside `leads.notes` for Lead Ads-sourced leads. Google Ads/GBP and inbound-email capture don't exist yet (`MASTER_ROADMAP.md` Phase 4, not started). Neither gap was worked around or faked; both surface as genuinely absent in the new dashboard.

Migration 026's live production status is unverified (`PRODUCTION_VERIFICATION_REPORT.md`, ENG-034) — this shaped the implementation, see below.

## What shipped

- **`src/lib/analytics/revenue-intelligence.ts`**:
  - `QUALIFIED_OR_BEYOND` hoisted from a local const inside `computeFunnel()` to module scope, so the new functions reuse the exact same "qualified" definition instead of a second copy.
  - `LeadCampaignRow` + a **separate, independently error-checked** query for `leads.campaign`/`utm_source`/`utm_medium`, merged into the main `leads` array in-memory. Deliberately NOT added to the core `leads` select: that query is a hard dependency of every existing section of this file (funnel, forecast, proposal analytics, sales productivity), and it has no `.error` check today — if migration 026 isn't live and the columns were requested in the same query, the entire `leads` array would silently become empty, breaking everything. Splitting the query means a missing migration degrades only `campaignPerformance`, verified with a dedicated test (see below).
  - `groupAcquisitionPerformance()` — one shared grouping/aggregation function (leads count, qualified leads, proposals, bookings, revenue, conversion%, avg booking value), used by both `computeChannelPerformance()` (keyed by `leads.source`) and `computeCampaignPerformance()` (keyed by `leads.campaign`, falling back to `'Organic / No Campaign'`, or a single `'Attribution Unavailable'` bucket if migration 026 isn't live) — one implementation, not two near-identical copies.
  - `computeMarketingBrief()` — deterministic, template-grounded in the real computed rankings (top/worst campaign by revenue among campaigns with real names; highest-revenue channel; lowest-conversion channel among channels with meaningful volume, threshold leads ≥ 3 to exclude noise). Same "not a real LLM call" convention the Founder Dashboard's AI Morning Brief already established — not a new pattern.
  - `RevenueIntelligence` interface and `buildRevenueIntelligence()` extended additively with `channelPerformance`, `campaignPerformance`, `marketingBrief`.
- **`src/app/api/dashboard/marketing/route.ts`** (new) — composes `buildRevenueIntelligence()` verbatim; returns the three new fields plus the pre-existing `eventSales.revenueByEventType/revenueByVenue/revenueByPackage` (Revenue Attribution — "which event type/property/package sells best") and `funnel` (Conversion Funnel), both reused unchanged, not recomputed. Explicit `roiNote` disclosing that ad spend isn't tracked anywhere, so a true ROI figure isn't fabricated.
- **`src/app/(crm)/dashboard/marketing/page.tsx`** (new) — Marketing Dashboard: AI Marketing Brief banner, Lead Source Analysis table, Campaign Performance table (with a visible banner when migration 026 is degraded), Revenue Attribution cards, Conversion Funnel, ROI Dashboard caveat section. Same "route/service computes, page only renders" split as the Founder Dashboard page.
- **`src/components/layout/CRMLayout.tsx`** — added a `/dashboard/marketing` nav link (same discoverability fix already applied for Founder/Revenue/Intelligence/Operations).
- **Tests**: extended `revenue-intelligence.test.ts`'s shared mock with campaign/utm fields and a two-query 'leads' mock (mirroring the real split), plus new test blocks for `channelPerformance`, `campaignPerformance`, and `marketingBrief` (5 new tests). New dedicated file `revenue-intelligence.campaign-degraded.test.ts` (3 tests) exercises exactly the regression this design protects against: when the campaign-only query errors (simulating migration 026 not being live), the core leads/funnel/channel data stays fully intact and `campaignPerformance.degraded` is reported honestly instead of a fabricated breakdown. 484 tests total (up from 476), zero regressions.

## What was verified vs. assumed

**Directly verified:** `tsc --noEmit` clean at each stage; full `vitest run` green (484/484, all 53 files); `next build` — full clean completion, `/api/dashboard/marketing` and `/dashboard/marketing` both present in the route table.

**Explicitly assumed, not verified:** migration 026's live production status remains unverified (ENG-034) — this sprint's contribution is making the code resilient to that fact (isolated query, honest degradation, disclosed in the UI and the AI brief), not resolving the underlying unknown. See `GO_LIVE_CHECKLIST.md` §1 for the verification script (`scripts/verify-migrations-026-027.sql`) that should be run before relying on live campaign attribution.

## Issues found

None new. This sprint added a capability rather than finding a defect in shipped behavior. One real design risk was caught and corrected mid-implementation (see "isolated query" above) before it reached tests or a build — not a shipped bug.

## Remaining / follow-up

Ad-level (individual advertisement ID) attribution, Google Ads/GBP, and inbound-email lead capture remain unbuilt — no existing foundation for any of the three, consistent with `MASTER_ROADMAP.md` Phase 4's "not started" status. A true ROI Dashboard (revenue ÷ actual ad spend) requires a spend-tracking data source that doesn't exist anywhere in this system yet; the current dashboard uses revenue-per-lead and conversion% as an explicitly-caveated proxy rather than inventing a number.
