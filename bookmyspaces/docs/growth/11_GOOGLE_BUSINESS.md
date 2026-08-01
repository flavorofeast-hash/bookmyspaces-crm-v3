# 11 — Google Business Profile Integration

## Business Objective

Google Business Profile (GBP) is the single highest-intent discovery surface for a local hospitality business — searches, direction requests, calls, and reviews all happen there before a prospect ever reaches the website or WhatsApp. This module brings GBP messaging, Q&A, posts, and — most importantly — reviews into the same CRM/social pipeline already built, rather than leaving GBP as a channel the operator checks manually in a separate Google console.

## User Journey

A prospect finds Skyline Serenity or Monurama Homestay via Google Maps, sends a GBP message ("do you have rooftop availability for a birthday on the 15th?"), and — once this module exists — that message is ingested exactly like a WhatsApp or Instagram DM: identity-resolved where possible, answered by the same AI orchestrator (grounded, human-handoff-capable), and visible on the customer's one timeline. Separately, a new Google review triggers the same review-management flow as a Facebook review (`16_REVIEW_MANAGEMENT.md`).

## Existing Code Reuse

- `src/lib/social/adapter-registry.ts` + `SocialAdapter` contract (`social/types.ts`) — `SOCIAL_MEDIA_ARCHITECTURE.md` explicitly designs GBP as "each platform = one adapter; adding one never touches CRM core." This module is a new adapter implementation against an existing, proven contract (`MetaAdapter` is the reference implementation to follow), not new architecture.
- `interaction-service.ts` (ingestion, sentiment, CRM linkage), `post-service.ts` (once publish is built per `10_SOCIAL_MEDIA.md`) — GBP posts and Q&A reuse these exact services with a new platform value, not parallel services.
- `reviews` table (migration 014) — already modeled to hold "aggregated Google/Facebook (+ booking platforms where feasible)" per `SOCIAL_MEDIA_ARCHITECTURE.md`'s own data model section.

## Required Database Changes

None beyond migration 014 (already shipped, already models Google as a review source). If GBP messaging requires state not covered by `social_interactions`, extend it additively (new nullable columns), not a parallel table.

## Required APIs

- `POST /api/social/webhook/google` (new) — same per-platform webhook pattern already established for `/api/social/webhook/[platform]`.
- GBP review-fetch: likely a polling job (`/api/cron/gbp-reviews`, new) rather than a webhook, since GBP's review notification support has historically been inconsistent — validate current API availability before committing to either approach (this module's single biggest open question).

## UI Changes

- Social page: add Google as a filterable interaction source alongside Facebook/Instagram, reusing the same UI already built for those, not a separate Google-specific screen.

## AI Opportunities

- AI-drafted responses to GBP Q&A and reviews, same grounded/human-approved pattern as everywhere else in this plan.
- AI-monitored "new competitor review" or "rating trend" alerts — natural fit for `19_AI_RECOMMENDATIONS.md`, reusing the notification infrastructure (`notification_settings` table) already in the schema.

## Risks

- **Explicitly flagged in `SOCIAL_MEDIA_ARCHITECTURE.md` already**: "GBP messaging API availability must be re-validated at build time (Google has deprecated/changed it before)." This is the single biggest risk in this module and should be the first thing engineering validates before estimating the rest of the work — this document does not assume the API is currently available in the form the architecture doc describes.
- OAuth token storage: encrypted at rest, centrally refreshed in the adapter layer, per the same rule already stated for all social tokens.

## Dependencies

- `10_SOCIAL_MEDIA.md` (shares adapter pattern, ingestion, UI), `16_REVIEW_MANAGEMENT.md` (GBP reviews are a primary input).

## Development Priority

**P2, contingent on an API-availability spike** — do not sequence real engineering time against this module until a short (days, not weeks) validation spike confirms GBP's current messaging/review API surface, given Google's history of changing it.
