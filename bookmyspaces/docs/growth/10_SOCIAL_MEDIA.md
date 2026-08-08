# 10 — Social Media Command Center

> **Status update (2026-08-07, `docs/sprints/2026-08-07_social-growth-platform-phase4.md`):** the "Verified this pass" note below (`post-service.ts` is "list + create only, no publish, no AI captioning, no cron scheduler") is now STALE — migrations 036/037 and the Social Growth Platform Phase 4 sprint added a real publish pipeline with retry/backoff (`publish-service.ts`), AI caption/hashtag/image-prompt/title/CTA generation with occasion templates (`content-generator.ts`), a cron scheduler (`/api/cron/social-publish`), intent classification + auto-lead-linking on the Unified Social Inbox, and weekly/daily calendar views. This file is left as historical context for the reuse/risk analysis below (still largely accurate) — see the sprint record for current, code-verified status.

This module operationalizes `SOCIAL_MEDIA_ARCHITECTURE.md`, which is already a complete design document — this doc translates it into the business-objective/journey/reuse/risk format used across this set and states current build status precisely (verified against actual service files, not assumed from the architecture doc alone).

## Business Objective

One inbox for every social interaction (comments, mentions, DMs, reviews) linked to the CRM customer profile where resolvable, plus a content studio/calendar for publishing — so social stops being a channel an operator checks separately and becomes part of the same customer timeline and growth loop as WhatsApp/email.

## User Journey

An Instagram comment or DM comes in. It's ingested (idempotent on platform+external_id, already implemented in `interaction-service.ts`), sentiment-classified (keyword-based today), linked to a CRM customer if a phone/email surfaces, and appears in a unified social queue. An operator (or, per `SOCIAL_MEDIA_ARCHITECTURE.md`, an AI auto-responder in human-approval mode initially) replies. Separately, the operator drafts a post in Content Studio, AI-generates a caption/hashtags, schedules it, and it publishes across connected platforms at the scheduled time.

## Existing Code Reuse

- `src/lib/social/{adapter-registry,interaction-service,dm-capture-service,meta-lead-capture,post-service,types}.ts` + `adapters/meta-adapter.ts` — the adapter contract, ingestion, sentiment classification, and lead-capture-from-DM logic already exist.
- `social_accounts`, `social_interactions`, `social_posts`, `reviews` (migration 014) — schema already shipped.
- `/api/social/{webhook/[platform],interactions,posts}` — already exist per the route inventory.
- **Verified this pass**: `post-service.ts`'s header explicitly states it is "list + create only" — no publishing (`adapter.publishPost` is not called), no AI captioning, no cron scheduler yet. This is a precise, code-confirmed statement of what remains to build, replacing any assumption that "the Social page" means publishing is done.

## Required Database Changes

None beyond migration 014 (already shipped) for interactions/inbox. If a publish-status audit trail beyond `social_posts.status` is needed, extend that table's status enum additively — do not add a parallel posts-log table.

## Required APIs

- `POST /api/social/posts/[id]/publish` (new) — the missing publish action `post-service.ts` explicitly does not yet call.
- `POST /api/social/posts/[id]/caption` (new, AI-assisted) — thin wrapper over `ai-provider.ts`.
- Scheduler: a cron route (`/api/cron/social-publish`, new) moving `scheduled` → `publishing` → `published`/`failed`, following the exact same queue/cron pattern already proven by `campaign-scheduler.ts`/`queue.ts` rather than inventing a new job runner.

## UI Changes

- Content Studio page (`src/app/(crm)/content-studio/page.tsx`) — verify its current completeness directly (this session found real drift between assumed-complete and actual-complete more than once); build out post composer, AI caption action, calendar view, and publish/schedule controls to the extent they're not already there.
- Social page: unify comments/mentions/reviews into one filterable queue if not already so structured.

## AI Opportunities

- AI captions/hashtags/SEO descriptions (`SOCIAL_MEDIA_ARCHITECTURE.md`'s Content Studio spec) via `ai-provider.ts` — no new AI infrastructure.
- Upgrade sentiment classification from the current keyword regex (`NEGATIVE`/`POSITIVE` word lists in `interaction-service.ts`) to model-scored sentiment — the file's own header already flags this as "upgradeable to model-scored behind the same column," i.e., an additive swap, not a redesign.
- AI auto-responder for comments/DMs, reusing the same orchestrator/grounding/handoff rules as WhatsApp/website chat (`AI_ARCHITECTURE.md`) — human-approval mode by default per `SOCIAL_MEDIA_ARCHITECTURE.md`'s own stated rollout plan.

## Risks

- Gated on Meta app review/permissions (`pages_messaging`, `instagram_manage_messages`) — a real external-dependency risk already flagged in `SOCIAL_MEDIA_ARCHITECTURE.md`, not something engineering effort alone resolves.
- DM inbox explicitly "rides" the Phase-4 channel adapters designed in `07_OMNICHANNEL.md` — building it before that cutover is stable means the same dual-system risk flagged in `04_GAP_ANALYSIS.md` A6.
- Publishing to real accounts is an irreversible, public action — per this plan's standing "human approval before destructive/public actions" rule, publish must always be an explicit human click, never a fully autonomous AI action, even once auto-captioning is trusted.

## Dependencies

- `07_OMNICHANNEL.md` (DM inbox), `16_REVIEW_MANAGEMENT.md` (reviews surfaced from this same schema), `17_SEO_AND_CONTENT.md` (shares Content Studio's AI generation).

## Development Priority

**P2** — schema and ingestion are real and already working; the remaining gap (publishing pipeline, content studio completeness) is a scoped, medium-effort build once `07_OMNICHANNEL.md` is stable.
