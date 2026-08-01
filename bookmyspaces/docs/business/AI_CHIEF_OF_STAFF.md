# AI Chief of Staff

**Status:** Built (Version 3.0, 2026-08-01). Part of the Business Knowledge Base — see `docs/business/README.md` (if present) or `docs/engineering/MASTER_ROADMAP.md`'s "Shipped since freeze" section for how this fits into the wider release history.

## Purpose

BookMySpaces already captures leads, proposals, bookings, revenue, and marketing performance across every channel. Before Version 3.0, understanding "how is the business doing and what should I do first" required opening the Founder Dashboard, Revenue/Intelligence Dashboard, and Marketing Dashboard separately and synthesizing them manually.

The AI Chief of Staff is a single **orchestration layer** that observes the outputs of those existing services, analyzes them into one composite Business Health Score, prioritizes the day's work, and recommends specific next actions — so the Founder can open one page and, within two minutes, know: Business Health, Expected Revenue, Revenue at Risk, Highest Priority Customers, Highest Priority Actions, Campaign Performance, Business Risks, Business Opportunities, and what to do first.

It is explicitly **not** a fourth analytics engine. It computes nothing that an existing service already computes. Where it does compute something new (the Business Health Score, Today's Priorities ranking, Predictive Insights, Business Risks/Opportunities), every input is a number an existing service already produced — this document's Decision Logic sections cite the exact source function for each one.

## Architecture

```
                         ┌──────────────────────────────┐
                         │   /api/dashboard/chief-of-    │
                         │   staff (route.ts)            │
                         └───────────────┬────────────────┘
                                          │
                         ┌────────────────▼────────────────┐
                         │ executive-brief-service.ts        │
                         │ buildExecutiveBrief()             │
                         │  (ORCHESTRATION ONLY)             │
                         └───┬──────────────┬────────────┬───┘
                              │              │            │
              ┌───────────────▼─┐  ┌─────────▼──────┐ ┌───▼─────────────────┐
              │ founder-brief-   │  │ proposal-       │ │ notification-        │
              │ service.ts       │  │ intelligence.ts │ │ producer.ts           │
              │ buildFounderBrief│  │ computeProposal-│ │ notifyMeaningfulEvents│
              │ (extracted from  │  │ Urgency()        │ │ (writes to the        │
              │ the Founder      │  │ (existing, pure) │ │ EXISTING notifications│
              │ Dashboard route) │  │                  │ │ table)                │
              └────────┬─────────┘  └──────────────────┘ └────────────────────┘
                       │
              ┌────────▼─────────────────────────────────┐
              │ revenue-intelligence.ts                    │
              │ buildRevenueIntelligence()                 │
              │  funnel · forecast · proposalAnalytics ·    │
              │  bookingAnalytics · customerAnalytics ·     │
              │  eventSales · pipelineBreakdown ·           │
              │  lostRevenue · channelPerformance ·         │
              │  campaignPerformance · marketingBrief        │
              └─────────────────────────────────────────────┘
                       │
              ┌────────▼─────────────────────────────────┐
              │ opportunity-score.ts / lead-intelligence.ts │
              │ getOpportunityScoreForLead() /               │
              │ computeIntelligence() (per-lead ranking)     │
              └───────────────────────────────────────────────┘
```

`buildFounderBrief()` (`src/lib/founder/founder-brief-service.ts`) was extracted from the Founder Dashboard route's GET handler *as part of this build* — it previously lived only inline in `src/app/api/dashboard/founder/route.ts`. The Chief of Staff needed the exact same Today's Opportunities ranking, Revenue Pipeline, Today's Schedule, and Lost Revenue Summary; re-deriving them a second time would have been the duplicate computation the Engineering OS forbids. `dashboard/founder/route.ts` now calls the same function and returns the identical response shape it always did — zero behavior change for the existing Founder Dashboard page.

## Data Sources (Dependency Map)

| Chief of Staff concept | Existing source (file → function) |
|---|---|
| Expected Revenue | `revenue-intelligence.ts` → `computeForecast()` (`forecast.totalForecast`) |
| Revenue at Risk | `proposal-intelligence.ts` → `computeProposalUrgency()`, summed over open proposals flagged follow-up/resend/escalate (new bounded query, existing pure function — see Architecture) |
| Top Opportunities / Highest Priority Customers | `opportunity-score.ts` → `getOpportunityScoreForLead()` + `lead-intelligence.ts` → `computeIntelligence()`, via `founder-brief-service.ts`'s `todaysOpportunities` |
| Top Customers | `revenue-intelligence.ts` → `computeCustomerAnalytics()` |
| Campaign Performance | `revenue-intelligence.ts` → `computeCampaignPerformance()` / `computeChannelPerformance()` (Version 2.1) |
| Business Risks / Opportunities | Composed from `lostRevenue`, `bookingAnalytics`, `channelPerformance`, `customerAnalytics`, `eventSales`, and open-proposal urgency — see Decision Logic below |
| Pending Follow-ups | `founder-brief-service.ts`'s `followUpsDue` (same query shape `dashboard/founder/route.ts` always used) |
| Site Visits | `visits/site-visit-service.ts` → `listSiteVisitsForDate()` |
| Proposal engagement ("viewed N times, no reply") | `proposals.viewed_count` / `last_viewed_at` (migration 010) via `proposal-intelligence.ts` → `computeProposalUrgency()` |
| Marketing Brief narrative | `revenue-intelligence.ts` → `computeMarketingBrief()` (Version 2.1) |
| Notifications | Existing `notifications` table + `/api/notifications` (GET/PATCH) — first writer is `notification-producer.ts` (see Limitations) |

No new tables, no new AI prompt, no new SQL aggregation was written for anything in the table above. The two genuinely new, disclosed queries (open-proposal-with-lead-context, and founder-tier user lookup) exist only because no existing service already returns those specific shapes as an importable function — see `executive-brief-service.ts`'s file header for the full disclosure.

## Business Rules

- The Chief of Staff never invents a business rule. Property Intelligence (Skyline/Monurama guards), pricing rules, and escalation policy are all owned elsewhere (`docs/business/01_PROPERTY_INTELLIGENCE.md`, `03_PRICING_RULES.md`, `07_AI_BEHAVIOR_RULES.md`) and are not re-implemented or re-checked here — this layer only reads outcomes (proposals, revenue, scores) that those rules already shaped upstream.
- "Founder-tier" audience for notifications is `user_profiles.role IN ('admin', 'manager')` — the same ownership convention already recommended in `audit/DATABASE_RECONCILIATION.md` for founder-tier data access.
- Every "Insufficient data" case is a deliberate business rule: if the underlying calculation doesn't exist or has no real data this window, the Chief of Staff says so rather than estimating.

## Decision Logic

**Today's Priorities** (`computeTodaysPriorities()`) merges three existing-signal sources into one ranked list, sorted by each item's own pre-existing urgency number (no new scoring):
1. `founderBrief.todaysOpportunities` — ranked leads, using `lead-intelligence.ts`'s `urgencyScore` (0-100).
2. Open proposals flagged by `computeProposalUrgency()` as needing follow-up, a resend, or escalation — ranked by that function's own `urgencyScore`.
3. `founderBrief.followUpsDue` (leads with a follow-up due today) not already represented above — ranked by `ai_score`.

Items are deduplicated by lead so the same customer never appears twice with conflicting reasons.

**Predictive Insights** — each field is either a direct read or a single disclosed arithmetic composition:
- Expected Revenue = `forecast.totalForecast` (unchanged).
- Revenue at Risk = sum of `total_price` for open proposals flagged by `computeProposalUrgency()`.
- Likely Bookings = `forecast.pipelineForecast ÷ proposalAnalytics.avgProposalValue`, rounded — "Insufficient data" if `avgProposalValue` is 0.
- High-value / Dormant Customers = `customerAnalytics.highValueCustomers` / `.dormantCustomers`, unchanged.
- Campaigns Likely to Perform = highest-conversion% campaign among `campaignPerformance.rows` with ≥3 leads (excludes "Organic"/degraded buckets) — "Insufficient data" otherwise.
- Packages Likely to Sell = top row of `eventSales.revenueByPackage` — "Insufficient data" if empty or zero revenue.

**Business Risks** (`computeBusinessRisks()`) fires only when a real threshold is crossed on an existing metric: lost-lead value > 0, no-follow-up losses > 0, occupancy ≥ 85%, a channel converting < 5% with ≥5 leads, cancellation rate ≥ 15%. No risk is invented if none of these are true — the list can legitimately be empty.

**Business Opportunities** (`computeBusinessOpportunities()`): proposals just viewed (best time to call), repeat-customer rate > 0, highest-converting channel with ≥3 leads, top revenue event type.

## Recommendation Logic

`computeAIRecommendations()` is deterministic and template-grounded — **not a real LLM call**, the same convention already established by the Founder Dashboard's AI Morning Brief and the Marketing Dashboard's AI Marketing Brief. It surfaces, in order: the single top Today's Priority item (named customer/proposal, not generic), the next-highest urgent proposal if different, `marketingBrief`'s existing budget/business recommendations (already specific — "Prioritize X campaign," "Y channel is converting best"), and the top-selling package by revenue. Every recommendation names a real customer, proposal number, campaign, or package — never a generic "follow up with leads" statement.

## Business Health Formula

**One score, 0-100.** Weighted average of up to 8 factors, each read from an existing calculation in `revenue-intelligence.ts`:

| Factor | Weight | Source |
|---|---|---|
| Lead Quality | 15 | Sales Funnel — Lead→Qualified conversion% (`computeFunnel`) |
| Pipeline Health | 15 | Pipeline Breakdown — share of leads in Negotiation or Booked (`computePipelineBreakdown`) |
| Proposal Conversion | 15 | Proposal Analytics — acceptance% (`computeProposalAnalytics`) |
| Booking Conversion | 15 | Sales Funnel — Negotiation→Booked conversion% (`computeFunnel`) |
| Marketing Performance | 10 | Channel Performance — leads-weighted avg conversion% (`computeChannelPerformance`, Version 2.1) |
| Revenue Trend | 10 | Booking Analytics — month-over-month revenue change, clamped ±50pp around a flat=50 baseline (`computeBookingAnalytics`) |
| Follow-up Discipline | 10 | Lost Revenue Summary — inverse of leads lost specifically to zero follow-ups (`computeLostRevenue`) |
| Customer Engagement | 10 | Customer Analytics — avg of repeat-customer% and non-dormant% (`computeCustomerAnalytics`) |

Weights sum to 100. If a factor has no real data this window (e.g. zero decided proposals, no reservation history), it is **excluded**, not defaulted to a fabricated value, and the remaining weights are re-normalized so the score stays meaningful — `businessHealthScore.formulaNote` always discloses exactly how many factors were available.

**"Response Time" was deliberately excluded** despite being suggested in the original brief: no aggregate, system-wide response-time metric exists anywhere in this codebase (only a per-lead value inside `lead-intelligence.ts`, never aggregated by any existing service). Adding one here would have meant either inventing a new aggregation or scoring off a small, non-representative sample — both against this build's "reuse, don't invent" constraint.

## Limitations

- **Notifications write to an undocumented table.** The `notifications` table exists live but is not defined in any migration file (`audit/DATABASE_RECONCILIATION.md`). Only `user_id`/`is_read`/`dismissed_at`/`read_at`/`created_at`/`priority` are confirmed by reading existing code; `notification-producer.ts` additionally assumes `title`/`message` columns exist. Every insert is wrapped in try/catch and logged, never fatal to the brief itself. Run `scripts/verify-notifications-columns.sql` before relying on this in production.
- **No ad-spend tracking** exists anywhere in this system (inherited limitation from Version 2.1) — Predictive Insights and Recommendations never compute a true ROI figure.
- **Response Time** is not part of the Business Health Score (see above) — a real gap, not a hidden one.
- **Revenue at Risk** only covers *open* proposals (sent/viewed, not yet decided) — it does not include leads that haven't reached proposal stage yet, which are a different, already-disclosed risk surface (`lostRevenue`).
- **Today's Priorities is bounded**, not exhaustive: it inherits the Founder Dashboard's existing 12-candidate opportunity bound and a 60-row open-proposal bound — both disclosed trade-offs already accepted elsewhere in this codebase for the same "predictable query cost" reason.
- **Ad-level attribution, Google Ads, inbound email** remain out of scope, unchanged from Version 2.1 — Campaign Performance here is exactly what Marketing Dashboard already shows, not enhanced.

## Future Scope

- Real-time Business Health Score caching (`ENG-022`, already backlogged for `buildRevenueIntelligence()`, would benefit this layer directly since it calls the same function).
- A scheduled daily run (see `schedule` capability in the wider platform) that generates and pushes the Executive Brief automatically each morning, rather than requiring the Founder to open the page.
- SQL-side aggregation (`ENG-021`) once data volume grows, benefiting every downstream consumer including this one.
- Extending the Business Health Score's Response Time factor once (if) a system-wide response-time aggregation is built as its own, separately-owned service — this document should be updated to cite it, not to compute it locally.
