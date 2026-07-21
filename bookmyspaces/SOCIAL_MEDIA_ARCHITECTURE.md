# SOCIAL_MEDIA_ARCHITECTURE.md

Last updated: 2026-07-21. New module — Social Media Command Center. Design-only until Roadmap Phase 5. Reuses the unified-conversation adapter pattern; CRM stays the system of record.

## Platforms

Phase order: Facebook + Instagram (Meta Graph — same app/webhook/HMAC infrastructure as the live WhatsApp integration) → Google Business Profile → YouTube → X → LinkedIn (API-permitting) → Threads (future). Each platform = one adapter; adding one never touches CRM core.

## Data Model (additive migrations, planned)

- `social_accounts` — connected platform accounts, OAuth tokens (encrypted), scopes, refresh state, health.
- `social_interactions` — comments, mentions, story/post replies, review events; FK → `customers` when identity-resolvable, else unlinked-but-triageable. (DMs do NOT live here — they flow through the existing unified conversation engine as normal channel adapters.)
- `social_posts` — drafts, scheduled, published; per-platform variants; media refs (Supabase Storage); status workflow (draft → approved → scheduled → published → failed).
- `reviews` — aggregated Google/Facebook (+booking platforms where feasible), rating, response draft, response status, trend rollups.
- Attribution: UTM/ref capture on website chat + booking flows → `analytics_events`, joining social → lead → proposal → reservation revenue.

## Components

1. **Unified Social Inbox** — one queue over `social_interactions` + social DM conversations; filters by platform/type/sentiment; every item linked to a CRM profile where possible; click-through to full customer timeline.
2. **AI Auto-Responder** — same AI orchestrator (see AI_ARCHITECTURE.md): grounded replies to comments/DMs/FAQs, sentiment detection, booking-enquiry capture → lead automation, escalation to human per standard handoff rules. Public comment replies default to human-approval mode until confidence history justifies auto-mode per platform (setting).
3. **Content Studio** — text/image/carousel/video/reel/story creation; AI captions, hashtags, SEO descriptions via ai-provider; media library in Supabase Storage.
4. **Content Calendar** — weekly/monthly planning, cross-platform scheduling; publisher worker (cron/queue — generalized `queue.ts` dispatcher) with per-platform rate handling and failure retry.
5. **Campaign Manager** — social campaigns with AI recommendations; ties into existing `campaigns` tables rather than a parallel system.
6. **Review Management** — aggregate, AI-draft responses (human-approved), rating trend tracking, alert on negative reviews.
7. **Analytics** — followers, reach, engagement, clicks, leads, bookings, attributed revenue, best content, best posting times; surfaces in main dashboards (channel performance).
8. **Social Listening** — brand/keyword/review monitoring, competitor activity where legal/feasible; significant-event alerts via notifications.

## Constraints & Risks

- Meta app review/permissions (pages_messaging, instagram_manage_messages, etc.) gate go-live — apply early in Phase 4.
- GBP messaging API availability must be re-validated at build time (Google has deprecated/changed it before).
- X/LinkedIn API pricing/access tiers may make those adapters read-only or deferred — decide per-platform at Phase 5 start, don't block the module on them.
- Token storage: encrypted at rest, never logged, refresh handled centrally in the adapter layer.
