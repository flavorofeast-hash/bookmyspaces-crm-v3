# BOOKMYSPACES V3 — MASTER ARCHITECTURE

Last updated: 2026-07-21. How the platform is built. Deep-dive grounding: `audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md` (428-line code-level review — still accurate except where noted below as since-implemented).

## Stack

Next.js 14.2.5 App Router + TypeScript · Supabase (Postgres, Auth, Storage, RLS) · Tailwind + Radix · Anthropic Claude primary / OpenAI fallback (`src/lib/providers/ai-provider.ts`) · Resend email · Meta WhatsApp Cloud API · Vercel (crons in `vercel.json`) · Vitest.

## Layering

```
UI (src/app/(crm), src/components)
  → Route handlers (src/app/api/**/route.ts)   [requireAuth()/requireRole() + zod parseBody()]
    → Services (src/lib/*, src/modules/*)       [business logic, tested]
      → Providers (src/lib/providers/*)         [AI, email, WhatsApp — swappable]
      → Supabase (session client for user CRUD; service-role ONLY for cron/AI/imports/admin — ISS-006 hybrid decision]
```

Rules: route handlers stay thin; logic lives in services with colocated `.test.ts`; new external integrations get a provider/adapter, never direct SDK calls from routes.

## Unified Conversation Engine (core pattern)

```
Channel webhook/API
  → Channel Adapter            (normalizes to ChannelMessage; idempotency key per channel)
  → Identity Resolution        src/lib/identity/resolve-identity.ts (phone → email → channel identifier → CRM record)
  → Unified Conversation Svc   src/lib/conversations/unified-conversation-service.ts
                               (channels / unified_conversations / unified_conversation_channels / unified_messages)
  → AI Orchestrator            grounded in knowledge_sources; confidence-scored; logs to ai_interaction_log
  → Human Agent                handoff on trigger; operator-assistant suggestions; can return to AI
  → Timeline                   src/lib/timeline/timeline-service.ts (one customer, one history)
```

Status: schema (migration 012) and service layer are BUILT. The live WhatsApp webhook (`src/services/whatsapp/process-inbound.ts`) and website chat (`src/app/api/chat/route.ts`) still run their legacy, channel-specific pipelines. **Cutover of these two channels through the unified engine is the first major implementation task** (Roadmap Phase 2). Legacy tables (`conversations`, `whatsapp_conversations`, `whatsapp_messages`) remain live during dual-write transition; retire only after verified parity.

Adding a channel = one new adapter + a `channels` row. No CRM-core changes. WhatsApp's 7-step inbound pipeline (idempotency, source detection, identity, conversation get/create, message log, activity log, auto-response) is the reference shape for every adapter.

## AI Layer

See `AI_ARCHITECTURE.md`. Key rule: `chatWithAI()` (channel-agnostic) is the only model entry point; all grounding comes from `knowledge_sources` + `ai_prompts` (DB-driven, CRM-editable) — the hardcoded `SYSTEM_PROMPT` pricing in `src/lib/ai.ts` is legacy and must be migrated to the knowledge base, not extended.

## Hospitality / Booking Layer

`properties` → `inventory_items` (rooms, halls, venues — typed) → `rate_plans` + `meal_plans` + `addon_services` → `reservations` (+`reservation_addons`) with availability engine (`src/lib/reservations/availability-service.ts`) and status workflow (`reservation-workflow.ts`, state-machine pattern copied from `lead-stage-manager.ts`). Proposals/invoices link via migration 013 (`reservation_id` FK alongside `lead_id`). Missing: admin CRUD UI (data entry is raw SQL today) — Roadmap Phase 1.

## Social Media Command Center

New module; see `SOCIAL_MEDIA_ARCHITECTURE.md`. Reuses the same adapter + unified-inbox pattern — social DMs ARE unified conversations; comments/mentions/reviews get a parallel `social_interactions` store linked to CRM customers where resolvable.

## Cross-Cutting

- **Auth:** middleware session check + public-page allowlist; every staff route `requireAuth()`/`requireRole()`; deliberate public routes documented (proposal share/preview/pdf, track-view, chat, WhatsApp webhook w/ HMAC).
- **Validation:** zod schemas via `src/lib/validation.ts` `parseBody()` on every route accepting input.
- **Env:** `src/lib/env.ts` `assertEnv()` at startup via `src/instrumentation.ts`. No direct `process.env` reads in features.
- **Observability:** `src/lib/logger.ts`; `ai_interaction_log` for AI; `email_log` for email. GAP: no Sentry/APM (Roadmap Phase 0), fragmented activity logging (`activity_logs`/`activity_events`/`analytics_events` — consolidate on `activity_events`, additively).
- **Jobs:** Vercel crons (`/api/cron/followups`, `/api/cron/escalations`); `src/lib/queue.ts` smartSend to be generalized into channel-dispatching outbound queue.

## Principles

1. Extend, never rebuild. 2. Adapters for every integration. 3. CRM is the single source of record. 4. Additive-only migrations; live DB is source of truth — verify before assuming (ISS-009/010 lesson). 5. One customer, one timeline. 6. Deployable at every phase end (build/tsc/lint/tests/docs). 7. Human approval before customer-facing sends and destructive actions.

## Known Environment Hazards (do not skip)

- File writes on this mount have silently truncated/null-padded before — verify every write (`wc -c`, JSON parse) per `audit/CURRENT_STATUS.md` process note.
- Working tree currently shows repo-wide line-ending-only diffs (CRLF churn). Add `.gitattributes` normalization in Phase 0 before real diffs get buried.
- Rewritten (PII-purged) git history still needs pushing to origin from a credentialed machine; stray root files (`007_missing_tables.sql`, `.git.stale-*`, backup dirs) need manual deletion.
