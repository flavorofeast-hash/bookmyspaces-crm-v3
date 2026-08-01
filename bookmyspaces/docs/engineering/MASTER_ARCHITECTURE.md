# MASTER_ARCHITECTURE.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Canonical HOW-it's-built reference. Consolidates `ARCHITECTURE.md`, `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md`, and `PERFORMANCE_REVIEW.md`'s durable findings. Those files remain as historical record; this is the one to keep current going forward.

## Stack

Next.js 14.2.5 (App Router) + TypeScript · Supabase (Postgres, Auth, Storage, RLS) · Tailwind + Radix UI · Anthropic Claude (primary) / OpenAI (fallback + embeddings) via `src/lib/providers/ai-provider.ts` · Resend (email) · Meta WhatsApp Cloud API · Vercel hosting + cron · Vitest.

## Domain Map

A business-domain view of the system, complementing the technical layering below — useful for "which part of the codebase owns this concept" questions. Domain boundaries here match `MASTER_DATABASE.md`'s table-domain groupings, so a schema question and an architecture question about the same feature should point to the same domain:

| Domain | Owns (business concept) | Primary services | Primary tables (`MASTER_DATABASE.md`) |
|---|---|---|---|
| CRM core | Leads, activity, follow-ups | `lead-stage-manager.ts`, `src/app/api/leads/**` | `leads`, `activity_logs`/`activity_events`, `follow_ups` |
| Conversations | Omnichannel messaging, one timeline | `unified-conversation-service.ts`, `resolve-identity.ts`, `timeline-service.ts` | `customer_identities`, `channels`, `unified_conversations`, `unified_messages` |
| Hospitality / Booking | Catalog, availability, pricing, reservations | `availability-service.ts`, `pricing-service.ts`, `reservation-workflow.ts` | `properties`, `inventory_items`, `rate_plans`, `meal_plans`, `addon_services`, `reservations` |
| Sales | Proposals, invoicing, payments | proposal builder services, `src/app/api/proposals/**`/`invoices/**` | `proposals`, `invoices`, `payments`, `stage_transitions` |
| Marketing / Growth | Campaigns, segments, referral, loyalty (designed, mostly not built — `docs/growth/`) | `campaign-scheduler.ts`, `queue.ts` | `campaigns`, `broadcast_campaigns`, `festival_calendar`, `message_queue` |
| Social | Unified social inbox, publishing, reviews | Meta adapter (schema live, pipeline incomplete) | `social_accounts`, `social_interactions`, `social_posts`, `reviews` |
| AI / knowledge | Grounded Q&A, extraction, orchestration | `ai-provider.ts`, `ai.ts`, `operator-assistant.ts` | `knowledge_chunks`, `knowledge_sources`, `ai_prompts`, `ai_interaction_log` |
| Ops / analytics | Dashboards, revenue intelligence, health | `revenue-intelligence.ts`, `lifetime-value.ts` | `analytics_events`, `staff_performance` (dormant), `system_health_log` |
| System | Auth, settings, audit | `auth-guard.ts`, `audit-log.ts` | `settings`, `email_log`, `user_profiles`, `admin_audit_log` |

This map is descriptive of current code, not a target for a service-oriented rewrite — the monolithic `src/lib` layering below remains the actual deployment shape. Its purpose is to keep future modules (especially growth-platform ones) filed under the right existing domain instead of spawning an adjacent, overlapping one.

## Layering (unchanged, load-bearing)

```
UI                 src/app/(crm)/**, src/components/**
  ↓
Route handlers     src/app/api/**/route.ts        — requireAuth()/requireRole() + zod parseBody()
  ↓
Services           src/lib/**, src/modules/**      — business logic, colocated .test.ts
  ↓
Providers          src/lib/providers/**            — AI, email, WhatsApp: swappable, no direct SDK use elsewhere
  ↓
Supabase           session client (user CRUD) / service-role client (cron, AI, imports, admin only — ISS-006)
```

**Rule for every future change**: route handlers stay thin. If you're writing an `if` statement deeper than input validation and calling a service inside a `route.ts` file, that logic belongs in `src/lib`. This is not a style preference — it's what keeps `.test.ts` coverage meaningful (services are unit-testable without spinning up Next.js routing).

## The Unified Conversation Engine (the architectural keystone)

```
Channel webhook/API
  → Channel Adapter          normalizes to a common message shape; idempotency key per channel
  → Identity Resolution      src/lib/identity/resolve-identity.ts (phone → email → channel id → CRM record)
  → Unified Conversation Svc src/lib/conversations/unified-conversation-service.ts
                             (channels / unified_conversations / unified_conversation_channels / unified_messages)
  → AI Orchestrator          grounded in knowledge_sources; confidence-scored; logs to ai_interaction_log
  → Human Agent              handoff on trigger; operator-assistant suggestions; can return control to AI
  → Timeline                 src/lib/timeline/timeline-service.ts — one customer, one history
```

**Current status (verify before assuming complete)**: schema (migration 012) and service layer are built; WhatsApp and website chat both dual-write into this system per `CHANGELOG.md`'s 2026-07-22 session, but legacy tables (`conversations`, `whatsapp_conversations`, `whatsapp_messages`) have not been retired — cutover is incomplete. Any new channel adapter (social DM, email-in, GBP) should be built against this unified engine directly, never against the legacy tables, even though the legacy tables are still technically live.

**Adding a channel** = one new adapter conforming to the existing contract + one `channels` row. WhatsApp's inbound pipeline (idempotency → source detection → identity → conversation get/create → message log → activity log → auto-response) is the reference shape every future adapter should follow — copy this shape, don't invent a new one.

## Hospitality / Booking layer

```
properties → inventory_items (rooms/halls/venues, typed)
                → rate_plans + meal_plans + addon_services
                → reservations (+ reservation_addons), availability-checked, state-machined
```

Availability: `src/lib/reservations/availability-service.ts`. Pricing: `src/lib/pricing/pricing-service.ts`. Workflow/state machine: `src/lib/reservations/reservation-workflow.ts` (pattern copied from `lead-stage-manager.ts` — reuse that same state-machine pattern for any new status-driven entity, don't invent a new one). Proposals/invoices link to reservations via migration 013's FK columns. See `MASTER_DATABASE.md` for the full table map and current apply-status caveats.

## AI layer

See `MASTER_AI.md` for full detail. One rule that belongs at the architecture level because violating it breaks the whole grounding model: `chatWithAI()` in `src/lib/ai.ts` is the *only* model entry point. No feature should call the Anthropic or OpenAI SDKs directly — go through `ai-provider.ts`.

## AI Safety & Approval Layer

Restated at the architecture level (not just in `MASTER_AI.md`/`MASTER_PRODUCT.md`) because it constrains where new AI features are allowed to write, not just how they should behave:

- **Human approval before any customer-facing send.** AI drafts, scores, and recommends; a human clicks send. This applies uniformly across every channel adapter (WhatsApp, website chat, and any future social/email adapter under Phase 4/5) and every AI-authored artifact (proposal copy, follow-up drafts, campaign content). No exception path exists in the current architecture, and none should be added without an explicit, recorded product decision in `MASTER_PRODUCT.md`.
- **Every AI decision is logged**, not just the ones that succeed — `ai_interaction_log` (and, for the newer orchestration path, `orchestration_decisions` from migration 025) is the audit trail. A new AI feature that doesn't write to one of these logs is, by this OS's standard, not yet safe to ship.
- **Confidence-scoring gates handoff, not just quality.** The existing AI Orchestrator → Human Agent handoff (see the Unified Conversation Engine diagram above) is the enforcement point: low-confidence or ambiguous cases route to a human rather than letting the AI guess customer-facing. Any new AI capability that can reach a guest directly must plug into this same handoff point rather than inventing its own threshold logic.
- **Grounding, not open generation.** `chatWithAI()`'s knowledge-grounded design (retrieval from `knowledge_sources`/`knowledge_chunks` before generation) is itself a safety property — it bounds what the model can assert about the business. Ungrounded free-generation for customer-facing content is out of scope unless a future MASTER_AI.md revision explicitly accepts that tradeoff.
- **This layer is a constraint on the growth-platform build-out**, not just current AI chat: every AI opportunity named in `docs/growth/` (AI sales assistant, AI-drafted review responses, AI recommendations) inherits these same rules by default — a growth-platform module doc that appears to bypass human approval for a customer-facing send should be treated as an error in that doc, not a new precedent.

## Integration / Plugin Architecture

Generalizes the "every integration is an adapter" principle (`MASTER_PRODUCT.md`) into an explicit architectural pattern, since the growth-platform plan (`docs/growth/`) adds several new external integrations (social platforms, OTA channels, email) that should all follow the same shape rather than each inventing bespoke glue code:

- **Contract**: an integration is a module under `src/lib/providers/**` (external services: AI, email, WhatsApp today) or a channel adapter conforming to the Unified Conversation Engine's inbound pipeline shape (webhook/API → normalize → idempotency key → identity resolution → conversation get/create → message log). WhatsApp's adapter is the reference implementation both new provider integrations and new channel adapters should be modeled on.
- **No direct SDK access outside the provider module.** Exactly as `ai-provider.ts` is the only door to Anthropic/OpenAI, every future third-party SDK (Meta Graph API for social, an OTA channel-manager API, Google Business Profile) gets one corresponding provider/adapter module — never called directly from a route handler or service.
- **Swap-ability is the test of a correct integration boundary.** If replacing WhatsApp's Cloud API with a different provider, or Anthropic with a different model vendor, would require touching more than the provider module and its config, the boundary is wrong and should be tightened before more integrations are added on top of it.
- **New integrations register, not fork.** Adding Instagram DM or Facebook Messenger (Phase 4) means one new adapter plus one `channels` row — not a parallel inbox, parallel identity system, or parallel timeline. This is the same reuse discipline `MASTER_DATABASE.md` applies to tables, applied to integration code.
- **OAuth/API credential vaulting** (needed for the Social Media Command Center, `docs/growth/10_SOCIAL_MEDIA.md`) is a new capability, not yet built — when it is, it should live alongside the existing provider pattern (a `social-provider.ts`-shaped module), not as a one-off credential store bolted onto a single feature.

## Cross-cutting concerns

- **Auth**: session middleware (`src/middleware.ts`) + `requireAuth()`/`requireRole()` (`src/lib/auth-guard.ts`) on every route except the documented public allowlist (`MASTER_API.md`). RLS is enabled on most tables but most `authenticated` policies are unscoped (`USING (true)`) — **authorization is enforced at the API layer, not by RLS row-scoping**. This is a deliberate, existing architectural choice, restated here because it means the security model depends on every route remembering to call the guard; RLS will not save a route that forgets. See `MASTER_SECURITY.md`.
- **Validation**: zod + `parseBody()` (`src/lib/validation.ts`) on every input-accepting route, `.strict()` on admin-facing schemas.
- **Env**: `src/lib/env.ts`'s `assertEnv()`, checked at startup via `src/instrumentation.ts`. No direct `process.env` reads inside feature code.
- **Observability**: `src/lib/logger.ts` (structured, redacts `phone`/`email`/`name` keys in the `data` object — but does **not** scan interpolated message strings, a real, currently-mitigated-by-discipline gap; see `MASTER_SECURITY.md`), `ai_interaction_log`, `email_log`. No APM/error-tracking service wired in as of this writing — see `MASTER_ROADMAP.md`.
- **Jobs**: Vercel cron (`vercel.json` + `/api/cron/*`), `src/lib/queue.ts` (rate-limited, spam-checked outbound message queue, `smartSend()`).
- **Audit trail**: `src/lib/audit-log.ts`, wired into settings/catalog/refund writes. Any new admin-mutable write path should wire into this, not invent a parallel log.

## Performance posture (from `PERFORMANCE_REVIEW.md`, durable findings)

- No N+1 query patterns exist in the analytics/dashboard layer — the established pattern is a small, fixed number of bulk queries (`Promise.all`), aggregated in memory. **Follow this pattern for any new analytics feature** (this is exactly what `docs/growth/18_ANALYTICS.md` commits to).
- This pattern has a known ceiling: full, unbounded table scans on `leads`/`proposals`/`reservations` are fine at current data volume but will need SQL-side aggregation (views/RPCs) once those tables reach tens of thousands of rows. Treat this as a triggered migration item, not a permanent design — track it in `MASTER_ROADMAP.md`, revisit when data volume approaches that order of magnitude.
- No caching layer exists on dashboard routes. A short TTL cache on aggregate results is a known, low-risk future win, not yet implemented.
- No heavy server-only dependency (`googleapis`, `xlsx`, `mammoth`, `pdf-parse`) leaks into the client bundle — keep it that way: these belong only in server-side lib files reached from API routes, never imported into a `'use client'` file.

## Known environment hazards (carried forward, still relevant to any AI-assisted session on this repo)

- This sandbox (and, per prior audit trail, every prior AI-assisted session on this project) has had no reliable network route to the production Supabase project or a working `next dev`/`next build` completion within tooling time limits. **Do not assume a "presumed complete" claim in any document — including this one — without independent verification when it matters** (this is not hypothetical: this session's own RC1 testing found the live `packages` schema had already drifted from its migration file, and found an unresolved reservation-pricing bug that could not be reproduced in application code alone). This is the single most important operating instruction for anyone — human or AI — maintaining this codebase.
- File writes on ephemeral sandboxes have, per prior audit notes, silently truncated before. Verify writes when it matters (`wc -c`, re-read).

## Principles (repeat of `MASTER_PRODUCT.md`, restated here because architecture decisions are where they're most often silently violated)

Extend, never rebuild · adapters for every integration · CRM is the single source of record · additive-only migrations, live DB is the source of truth · one customer, one timeline · deployable at every phase end · human approval before customer-facing sends and destructive actions.
