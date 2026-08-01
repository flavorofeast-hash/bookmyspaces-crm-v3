# 16 — Review Management

## Business Objective

Reviews are the highest-trust conversion signal for a hospitality business (Booking.com/Google both surface them prominently), and the `reviews` table already exists (migration 014) — this module turns stored review data into an active workflow: aggregate, alert on negative reviews fast, draft AI responses for human approval, and close the loop by asking happy guests to leave one in the first place.

## User Journey

A guest leaves a 5-star Google review. It's ingested into `reviews` (via the GBP adapter, `11_GOOGLE_BUSINESS.md`) or a 2-star Facebook review comes in via the existing Meta adapter. Either way: it appears in a review queue, sentiment/rating-based prioritization surfaces the negative one first, an AI-drafted response is ready for one-click human approval, and the operator sees a rating-trend chart without leaving the CRM. Separately, `08_CUSTOMER_JOURNEY.md`'s post-stay message includes a direct review-request link for guests who haven't left one.

## Existing Code Reuse

- `reviews` table (migration 014) — already modeled per `SOCIAL_MEDIA_ARCHITECTURE.md`: "aggregated Google/Facebook... rating, response draft, response status, trend rollups." This module is building the workflow *on* an already-correct data model, not designing a new one.
- `src/lib/social/interaction-service.ts` — sentiment classification (`classifySentiment()`) is directly reusable for review prioritization, same keyword-based approach today, same upgrade path to model-scored later.
- `notification_settings` table — negative-review alerts are a natural fit for whatever notification infrastructure already exists here, not a new alerting system.
- `ai-provider.ts` — AI-drafted review responses, same grounded/human-approved pattern as every other AI-generated customer-facing text in this plan.

## Required Database Changes

None beyond migration 014 — `reviews` already has the columns this workflow needs (per the architecture doc's own data model section). Verify the live schema matches before building (per the A2 lesson in `04_GAP_ANALYSIS.md` — this session already found one table where migration-file columns didn't match live reality).

## Required APIs

- `GET /api/reviews` (list, filterable by rating/platform/response-status), `POST /api/reviews/[id]/respond` (submit human-approved response, publish via the relevant platform adapter) — additive routes following existing conventions (`requireRole`, zod validation, thin handler).
- Review ingestion itself is a byproduct of `10_SOCIAL_MEDIA.md`/`11_GOOGLE_BUSINESS.md`'s adapters, not a separate ingestion path.

## UI Changes

- New "Reviews" view — could live under the Social page as a tab (reviews are conceptually social data) or as its own CRM nav item given how central review management is to hospitality; recommend a tab under Social first, promote to standalone only if usage justifies it.
- Rating-trend chart, reusing whatever charting approach the existing dashboards already use rather than introducing a new charting library.

## AI Opportunities

- AI-drafted responses to every review (positive and negative — positive reviews still deserve a personalized thank-you, which is where AI drafting saves the most operator time on the lowest-stakes text).
- AI-summarized "themes in recent reviews" (e.g., "3 recent reviews mention slow check-in") feeding directly into `19_AI_RECOMMENDATIONS.md` and into operations conversations, not just marketing ones.

## Risks

- Negative reviews are reputationally sensitive — responses must always be human-approved before publishing, no exceptions, even once AI drafting quality is trusted (this is a stricter version of the general "human approval on public/outbound actions" rule, warranted by the stakes).
- GBP review ingestion inherits `11_GOOGLE_BUSINESS.md`'s API-availability risk directly.

## Dependencies

- `10_SOCIAL_MEDIA.md`/`11_GOOGLE_BUSINESS.md` (review ingestion sources), `08_CUSTOMER_JOURNEY.md` (review-request trigger).

## Development Priority

**P2** — high business value, low technical risk (the hard part, the data model, already exists); can proceed in parallel with `10`/`11` once at least one review source is ingesting real data.
