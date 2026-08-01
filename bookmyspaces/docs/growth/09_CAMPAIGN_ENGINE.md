# 09 — Campaign Engine

## Business Objective

Take the existing campaign system (`campaigns`/`broadcast_campaigns`, `campaign-scheduler.ts`) from "scheduled WhatsApp/festival broadcasts to a segment" to a genuine multi-channel (WhatsApp + email, per `13_EMAIL_MARKETING.md`) campaign engine with reusable segments (`05_MARKETING_PLATFORM.md`) and closed-loop attribution — the HubSpot-style "workflow" concept, sized for this product's scale.

## User Journey

An operator picks a segment (`05_MARKETING_PLATFORM.md`), writes or AI-generates copy (reusing `generateFestivalMessage()`'s pattern), picks channel(s), schedules or sends immediately, and later sees delivery + attributed-booking counts on the same campaign record — all from one Campaigns page, not a separate marketing tool.

## Existing Code Reuse

- `src/lib/campaign-scheduler.ts` — already routes sends through `queue.ts` instead of a synchronous per-request loop, already tags `message_queue.metadata.campaign_id` for attribution. This is the engine; this module extends its channel support and trigger types, it does not replace it.
- `src/lib/campaigns.ts` — `buildSegment()`, `generateFestivalMessage()`.
- `campaigns`/`broadcast_campaigns` tables (migrations 004/020/021, including the paused/cancelled status and recurrence columns already added in 021) — recurrence scheduling infrastructure already exists; reuse it for non-festival recurring campaigns (e.g., a monthly newsletter) rather than building a second scheduler.
- `src/lib/queue.ts` — rate limiting, spam check (`wasRecentlyContacted()`), `smartSend()`.

## Required Database Changes

- Additive: `campaigns.channel` (if not already supporting a value set beyond WhatsApp — verify against live schema per the A2 drift lesson before assuming the column needs to be added) to support email as a send channel alongside WhatsApp.
- Reuses `marketing_segments` from `05_MARKETING_PLATFORM.md` rather than a campaign-specific segment table.

## Required APIs

- Extend `/api/campaigns` (already exists) to accept a `channel` field and a `segmentId` reference instead of (or alongside) its current inline audience-building — additive request fields, not a new route family, per `API_SPECIFICATION.md`'s "version via additive params" convention.

## UI Changes

- Campaigns page: channel picker, segment picker (from `05_MARKETING_PLATFORM.md`'s UI), and a per-campaign attribution readout (bookings/revenue this campaign is linked to).

## AI Opportunities

- AI copy generation for any campaign type, generalizing `generateFestivalMessage()`.
- AI-suggested send time per segment based on historical open/response patterns already loggable via `message_queue`/`activity_logs`.
- AI-suggested next campaign ("Diwali is in 3 weeks, your last Diwali campaign to this segment had a 12% booking rate — send again?") — a natural `19_AI_RECOMMENDATIONS.md` extension once attribution history exists.

## Risks

- Email as a new channel means this module is blocked on `13_EMAIL_MARKETING.md`'s inbound/bounce-handling design existing first, or campaigns risk sending into a channel with no complaint/unsubscribe handling — a real compliance risk (CAN-SPAM/India's forthcoming data-protection rules), not just a UX gap.
- Same over-messaging/spam-check composition risk named in `08_CUSTOMER_JOURNEY.md` — this module and that one must share one rate-limit/frequency-cap enforcement point (`queue.ts`), not two independent ones.

## Dependencies

- `05_MARKETING_PLATFORM.md` (segments), `13_EMAIL_MARKETING.md` (email channel), `18_ANALYTICS.md` (attribution reporting).

## Development Priority

**P2** — valuable, but reasonably sequenced after `05_MARKETING_PLATFORM.md`'s segmentation scaffolding and after email marketing's compliance-critical unsubscribe/bounce handling exists.
