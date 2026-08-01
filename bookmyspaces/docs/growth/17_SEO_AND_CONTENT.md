# 17 — SEO and Content

## Business Objective

Local SEO (two properties, one metro market) and content operations (blog/landing content, social captions, GBP posts) share one need: consistent, on-brand, keyword-aware content generated faster than an operator can write it manually — using the AI provider layer already in place, and the Content Studio surface already scaffolded (`10_SOCIAL_MEDIA.md`), rather than a separate content tool.

## User Journey

An operator wants a blog post about "best rooftop venues for a birthday party in Kolkata." They open Content Studio, describe the topic, and get an AI-drafted post (grounded in the same `knowledge_sources`/`packages.ai_description` corpus already used for chat, so the content doesn't contradict what the AI tells customers) with suggested title/meta description/keywords, ready for human edit and publish.

## Existing Code Reuse

- `src/lib/providers/ai-provider.ts` — same provider layer, no new AI infrastructure.
- `knowledge_sources` + `packages.ai_description` — reusing the exact same grounding corpus as customer-facing chat means content and chat answers stay consistent (a real, currently-unrealized benefit of wiring the vector RAG gap named in `04_GAP_ANALYSIS.md` A5 — SEO content generation is another consumer that benefits once that's fixed, not a reason to block this module on it).
- Content Studio page (`10_SOCIAL_MEDIA.md`) — this module extends it with a "long-form content" mode alongside social captions, rather than building a second content tool.

## Required Database Changes

- Additive: `content_items` (`id`, `type` [blog/landing/gbp-post], `title`, `body`, `status` [draft/published], `seo_meta` JSONB, `published_at`) if BookMySpaces' public website is meant to pull content from the CRM. If the public site is a separate codebase/CMS not covered by this repository, this table instead becomes an export/handoff mechanism (generate here, publish there manually or via API) — this document does not assume which, since the public website's own architecture was out of scope for this repo audit.

## Required APIs

- `POST /api/content/generate` (AI draft), `GET/POST /api/content` (CRUD) — additive, standard conventions.

## UI Changes

- Content Studio: add a content-type selector (social post vs. blog/landing vs. GBP post) sharing one AI-generation panel.

## AI Opportunities

- Keyword/topic suggestions based on what prospects actually ask the AI chat about (`ai_interaction_log` is a real, already-collected signal of real customer questions — mining it for content topics is a genuinely novel, low-effort opportunity specific to this business, not a generic AI feature).
- Auto-generated FAQ content directly from the knowledge base, keeping SEO content and chat answers provably consistent.

## Risks

- The biggest open question this module has is one this repo audit cannot answer: where does the public website (`bookmyspaces.in`) actually get its content from today, and is it in this repository at all? `README.md`/`BOOKMYSPACES_V3_MASTER_SPECIFICATION.md` describe the CRM and AI chat widget but not a CMS. This must be answered before committing to `content_items` as a real publishing mechanism versus a draft-and-export tool.
- AI-generated SEO content risks factual drift from the actual knowledge base if not strictly grounded — same safety rule as chat: no invented pricing/availability/facts.

## Dependencies

- `10_SOCIAL_MEDIA.md` (shared Content Studio surface), A5 in `04_GAP_ANALYSIS.md` (grounding quality).

## Development Priority

**P3, pending the public-website architecture question above** — do not commit to the `content_items` publishing design until that's answered; the AI-drafting capability itself can be built as a Content Studio feature regardless of where the final content ends up.
