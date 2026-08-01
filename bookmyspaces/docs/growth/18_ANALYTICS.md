# 18 — Analytics (Growth & Attribution)

## Business Objective

Extend the already-substantial analytics that exist (Revenue Intelligence's funnel/forecast/proposal/booking/customer/productivity analysis) with the one thing a growth platform needs that a sales-operations CRM doesn't: attribution — which channel, campaign, or organic source actually produced a given lead and booking — reported inside the same dashboards, not a separate marketing-analytics tool.

## User Journey

An operator opens the existing Revenue Dashboard and now sees, alongside figures it already computes, a channel/campaign breakdown: "WhatsApp organic: 40% of bookings, Instagram: 15%, Referral: 10%, Festival campaign (Durga Puja): ₹85,000." No new dashboard to learn — the existing one gains a dimension.

## Existing Code Reuse

- `src/lib/analytics/revenue-intelligence.ts` — the "fetch once, reduce in JS, no N+1" performance contract this file already establishes is the pattern this module's attribution queries follow, not a new query strategy.
- `analytics_events` + `track_event()` RPC (migration 007) — already exists for generic event tracking; this module is primarily about *using* it more (UTM capture on chat/booking entry points) rather than building new event infrastructure.
- `message_queue.metadata.campaign_id` (via `campaign-scheduler.ts`) and the `campaign_attribution`/`email_log.campaign_id` additions from `05_MARKETING_PLATFORM.md`/`13_EMAIL_MARKETING.md` — this module's dashboards are the read side of data those modules already write.
- `stage_transitions` (migration 019) — funnel timing already captured; channel-segmented funnel timing is an additive `GROUP BY` on existing data, not new instrumentation.
- `src/lib/customers/lifetime-value.ts` — per-customer revenue, reusable for cohort/channel LTV comparisons.
- `staff_performance` (dormant table, `04_GAP_ANALYSIS.md` B) — this module is the natural first reader/writer of this table for sales-productivity-by-operator reporting, closing a gap that's been sitting in the schema unused.

## Required Database Changes

- Reuses `analytics_events`, `campaign_attribution` (`05_MARKETING_PLATFORM.md`), `email_log.campaign_id` (`13_EMAIL_MARKETING.md`) — no new tables specific to this module beyond what those already define.
- Activates `staff_performance` (schema exists, currently unused) with real write paths from proposal/reservation creation events.

## Required APIs

- Extend `/api/dashboard/revenue` and `/api/analytics` (both already exist) with additive query params (`groupBy=channel`, `groupBy=campaign`) rather than new routes, consistent with `API_SPECIFICATION.md`'s additive-versioning convention.

## UI Changes

- Revenue Dashboard: add channel/campaign breakdown views (chart + table) alongside existing figures.
- New "Staff Performance" view activating the dormant table, if prioritized — otherwise explicitly deferred, not silently dropped.

## AI Opportunities

- AI-generated narrative summaries of dashboard data ("bookings from Instagram are up 20% this month, mostly from the new reel campaign") — genuinely useful for a single operator who doesn't have a dedicated analyst reading charts daily; reuses `ai-provider.ts`, no new AI infra.
- Anomaly flagging (a sudden drop in a channel's conversion rate) surfaced as a notification, reusing `notification_settings`.

## Risks

- Attribution accuracy has a hard floor set by `04_GAP_ANALYSIS.md` Section C: no retroactive attribution for sends before `campaign-scheduler.ts`'s tagging existed. Report attribution as "since campaign tracking began," not as if it covers all historical revenue — an honesty constraint on the dashboard copy itself, not just an engineering note.
- Multi-touch attribution (a guest who saw an Instagram post, then found GBP, then booked via WhatsApp) is genuinely hard and this module does not attempt it — last-touch or first-touch attribution (pick one, document the choice) is the realistic v1 scope.

## Dependencies

- `05_MARKETING_PLATFORM.md`, `09_CAMPAIGN_ENGINE.md`, `13_EMAIL_MARKETING.md` (all write the attribution data this module reads).

## Development Priority

**P2** — valuable but structurally a downstream reader of data the marketing/campaign/email modules produce; sequence after at least one of those has real attribution data flowing.
