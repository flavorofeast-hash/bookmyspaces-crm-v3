# 05 — Marketing Platform (umbrella module)

This is the umbrella design for BookMySpaces' marketing capability — the thing that makes `leads`/`reservations`/`social_interactions` data actionable as segments, journeys, and attributed spend, instead of a static CRM record. It does not duplicate `09_CAMPAIGN_ENGINE.md` (the send engine), `13_EMAIL_MARKETING.md` (the email channel), `10_SOCIAL_MEDIA.md`/`11_GOOGLE_BUSINESS.md` (acquisition channels), or `18_ANALYTICS.md` (attribution reporting) — it is the layer that ties them together: one segmentation model, one journey definition format, one attribution key, reused by all of them.

## Business Objective

Turn marketing from "send a WhatsApp blast for a festival" (today's real capability, per `lib/campaigns.ts`) into a repeatable system: define an audience once, trigger campaigns off CRM state or calendar, and see which channel/campaign actually produced a booking — using the data already in `leads`, `reservations`, `proposals`, and `analytics_events`, not a bolted-on marketing-only database.

## User Journey

**Marketing operator** (likely the same person as the sales operator, given single-tenant scale): opens a "Segments" view, builds a filter (e.g. "stayed at Monurama in the last 90 days, no reservation since") using fields already on `leads`/`reservations`, saves it, attaches it to a campaign (`09_CAMPAIGN_ENGINE.md`) or a journey (`08_CUSTOMER_JOURNEY.md`), and later sees — in the existing Revenue Dashboard, not a new dashboard — how many bookings that segment's campaign produced.

## Existing Code Reuse

- `src/lib/campaigns.ts`'s `buildSegment()` — already builds an audience from lead/reservation criteria; this module generalizes it into a reusable segment definition rather than a one-off function per campaign type.
- `src/lib/campaign-scheduler.ts` — the send/queue/attribution-tagging mechanism already exists and already routes through `queue.ts`; new campaign types reuse this, they don't get a second sender.
- `analytics_events` + `track_event()` RPC (migration 007) — the generic event table already exists for attribution capture; extend its usage, don't add a parallel events table.
- `lifetime-value.ts` and Revenue Intelligence (`revenue-intelligence.ts`) — segment definitions should be expressible against the same fields these already compute from, so "segment size" and "segment revenue" are the same query family as the existing dashboards, not a new reporting stack.

## Required Database Changes

Additive only, consistent with `DATABASE_ARCHITECTURE.md` Rule 1:

- `marketing_segments` (new table): `id`, `name`, `filter_definition` (JSONB — the same shape `buildSegment()` already consumes, formalized), `created_by`, `created_at`, `is_active`.
- `campaign_attribution` (new table, or an additive column set on existing `analytics_events` — decide at implementation time based on live-schema verification per A2 in `04_GAP_ANALYSIS.md`): links a `campaign_id`/`utm_source` to a resulting `leads.id`/`reservations.id`. Reuses the "tag on `message_queue.metadata.campaign_id`" pattern `campaign-scheduler.ts` already established, extended to also stamp new leads created from a campaign click.
- No changes to `leads`, `reservations`, `proposals` schemas themselves.

## Required APIs

- `GET/POST /api/marketing/segments`, `GET /api/marketing/segments/[id]/preview` (count + sample, reusing existing lead/reservation query patterns) — follows `API_SPECIFICATION.md` conventions (`requireRole`, zod + `parseBody`, thin handler over a service).
- `GET /api/marketing/attribution?campaignId=` — thin wrapper, same "fetch once, reduce in JS" performance contract `revenue-intelligence.ts` already uses.

## UI Changes

- New "Segments" tab, likely under the existing Campaigns page rather than a new top-level nav item (keeps marketing surface area consolidated, matches the single-operator scale of this product).
- Revenue Dashboard gains an optional "by campaign/segment" breakdown — additive UI on an existing page, not a new dashboard.

## AI Opportunities

- AI-suggested segments ("guests who asked about weddings but never received a proposal") generated from `ai_interaction_log`/`leads` patterns, using the same provider layer (`ai-provider.ts`) already in use — no new AI infrastructure.
- AI-drafted campaign copy reusing `generateFestivalMessage()`'s existing pattern (`campaigns.ts`), generalized beyond festivals.

## Risks

- Segment definitions expressive enough to be useful but simple enough not to become a second query language — recommend starting with a fixed set of filterable fields (event_type, property, last_stay_date, lead_stage, budget_band) rather than an open-ended query builder.
- Attribution accuracy is bounded by what `campaign-scheduler.ts` already acknowledges: no retroactive attribution for sends before that tagging existed (see `04_GAP_ANALYSIS.md` Section C).

## Dependencies

- `09_CAMPAIGN_ENGINE.md` (consumes segments), `18_ANALYTICS.md` (reports on attribution), `A1`/`A2` in `04_GAP_ANALYSIS.md` if segments ever filter on `reservations` fields.

## Development Priority

**P1 (foundational for all marketing modules)** — segments and attribution are consumed by nearly every other module in this document set; build this scaffolding early, even though it has no standalone customer-facing value on its own.
