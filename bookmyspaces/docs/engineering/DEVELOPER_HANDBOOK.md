# BookMySpaces CRM — Developer Handbook v1.1

Read this once, end to end, before touching code. It gets a senior engineer productive in a day: what's built, how it's organized, and the conventions that keep 50+ tables and 100+ routes from becoming unmaintainable. For historical depth on any topic, the canonical `docs/engineering/MASTER_*.md` files are the source this handbook is distilled from — go there when you need the full reasoning, come back here for the working model.

---

## 1. Overall Architecture

**Stack**: Next.js 14 (App Router) + TypeScript · Supabase (Postgres, Auth, Storage, RLS) · Tailwind + Radix UI · Anthropic Claude (primary) / OpenAI (fallback) via one provider layer · Meta WhatsApp Cloud API · Vercel hosting + cron · Vitest.

**Layering (load-bearing, don't violate it)**:
```
UI                 src/app/(crm)/**, src/components/**
  ↓
Route handlers     src/app/api/**/route.ts   — requireAuth()/requireRole() + zod parseBody()
  ↓
Services           src/lib/**, src/modules/**  — business logic, colocated .test.ts
  ↓
Providers          src/lib/providers/**       — AI/email/WhatsApp: swappable, no direct SDK use elsewhere
  ↓
Supabase           session client (user CRUD) / service-role client (cron, AI, imports, admin only)
```
Route handlers stay thin: auth → validate → call one service → shape the response. Any loop, multi-step conditional, or direct Supabase query beyond a single service call inside a `route.ts` file is a smell — that logic belongs in `src/lib`.

**The architectural keystone is the Unified Conversation Engine**: every channel (WhatsApp, website chat, Facebook/Instagram DM) normalizes through the same pipeline — channel adapter → identity resolution (`src/lib/identity/resolve-identity.ts`) → `unified-conversation-service.ts` → AI orchestrator (grounded, confidence-scored) → human handoff → `timeline-service.ts`. One customer, one history, regardless of channel. New channels register an adapter against this pipeline; they never get a parallel inbox, identity system, or timeline. Note: legacy tables (`conversations`, `whatsapp_conversations`, `whatsapp_messages`) are still dual-written and not yet retired — check `MASTER_DATABASE.md` before assuming either the legacy or unified path alone is authoritative for a given read.

**Non-negotiable safety layer**: AI drafts, scores, and recommends; a human clicks send. No customer-facing AI output (message, proposal, campaign) leaves the system without an explicit human action, on any channel, no exceptions. Every AI decision is logged (`ai_interaction_log`). This constrains every future feature, not just current chat.

**Cross-cutting**: auth via `src/middleware.ts` + `requireAuth()`/`requireRole()` (`src/lib/auth-guard.ts`) — **RLS is enabled but mostly unscoped (`USING (true)`); authorization is enforced at the API layer, not by RLS.** Validation via zod + `parseBody()`. Env via `src/lib/env.ts`'s `assertEnv()` — no bare `process.env` reads in feature code. Logging via `src/lib/logger.ts`. Jobs via Vercel cron + `src/lib/queue.ts`'s rate-limited `smartSend()`.

---

## 2. Folder Structure

```
src/
  app/
    (crm)/            All internal, authenticated CRM pages (dashboard/, inbox/, proposals/,
                       reservations/, whatsapp/, campaigns/, customers/, leads/, catalog/, ...)
    api/               Every route handler, mirrors the domains below (leads/, proposals/,
                       whatsapp/, cron/, dashboard/, admin/, ...)
    admin/, analytics/, auth/   Non-(crm)-grouped surfaces (public/admin/analytics entry points)
    [campaign]/        Public campaign-landing-page catch-all route
  components/          Shared UI: auth/, chatbot/, landing/, layout/ (CRMLayout.tsx = nav), leads/, payments/
  lib/                 The bulk of business logic — one subfolder per domain (see Module Map)
  modules/             A handful of narrower, newer domain modules (automation/, followups/, leads/)
  services/            Thin orchestration layer for a couple of pipelines (whatsapp/process-inbound.ts)
  types/               Domain types colocated by concern (reservation.ts, timeline.ts, ai-context.ts)
  constants/           Static config/enums
supabase/
  migrations/          Numbered, paired with a `_ROLLBACK.sql` sibling for every migration. Additive-only.
  seed/                Seed data
docs/
  engineering/         MASTER_*.md — the canonical, always-current reference set (read these, not audit/)
  business/            Product/behavior policy docs (AI behavior rules, product success metrics)
  sprints/, releases/  Dated, point-in-time session records — historical, not canonical
  growth/              Designed-but-mostly-unbuilt growth-platform module specs (numbered 05–21)
audit/                 Historical audit trail (CHANGELOG, backlog snapshots, reports) — read for
                       context, but docs/engineering/MASTER_*.md supersedes it for current state
scripts/               One-off verification/migration scripts (verify-*.sql, apply-v3-migrations.mjs)
```

**Rule of thumb for "where does this go"**: if it's a page, `src/app/(crm)/<feature>/page.tsx`. If it's an API route, `src/app/api/<feature>/route.ts`. If it's logic, `src/lib/<domain>/<name>-service.ts` (or `<domain>-workflow.ts` for multi-step orchestration). Never put business logic in a route handler or a page component.

---

## 3. Module Map

`src/lib/` by domain — the map of "which folder owns this concept":

| Folder | Owns |
|---|---|
| `ai/` | Operator assistant, context builder, orchestration engine (disabled by default), slot memory |
| `analytics/` | Revenue intelligence, growth intelligence, marketing AI (deterministic briefs) |
| `campaigns/` | Campaign config/segments (`campaigns.ts`, `campaign-scheduler.ts` at lib root) |
| `chief-of-staff/` | Executive brief orchestration, notification producer |
| `conversations/` | Unified conversation service, outbound dispatcher, WhatsApp↔unified sync |
| `customers/` | Journey engine, lifetime value, loyalty, referrals |
| `email/` | Email sending/templates |
| `events/` | Event-type catalog |
| `founder/` | Founder brief service |
| `identity/` | Cross-channel identity resolution |
| `knowledge/` | Knowledge base retrieval (keyword `ilike` today — see §6) |
| `leads/` | Lead pipeline, auto-package recommendation, create-lead-with-journey |
| `packages/`, `pricing/`, `proposals/` | Catalog pricing, proposal generation/intelligence |
| `providers/` | The **only** door to external SDKs (AI, email) |
| `reservations/` | Availability, reservation workflow (state machine) |
| `settings/` | Settings-backed config reads |
| `social/` | Social DM capture/response (Facebook/Instagram) |
| `timeline/` | Customer Timeline (multi-source merge) |
| `visits/` | Site-visit scheduling |
| `whatsapp/` | Auto-qualify, auto-responder, drip sequences, conversation manager, send/verify |

`src/modules/` — narrower, more recently added: `automation/` (escalation engine), `followups/` (cadence rules — largely superseded by `whatsapp/auto-qualify.ts` + `/api/cron/ai-followup-assistant`, see §12), `leads/` (shared types).

`src/services/whatsapp/process-inbound.ts` is the single inbound WhatsApp pipeline entry point — read it first if touching anything WhatsApp-related.

---

## 4. API Conventions

Every route, no exceptions unless it's on the Public Allowlist below:

1. **Auth**: `requireAuth()` or `requireRole([...])` (`src/lib/auth-guard.ts`) as the first line of the handler.
2. **Validation**: a zod schema + `parseBody()` (`src/lib/validation.ts`) for every body-accepting route. `.strict()` on admin-facing schemas — mass-assignment protection, paired with an explicit column allow-list at the service layer (two independent layers, not redundant).
3. **Thin handlers**: one service call, response shaping only.
4. **Client selection**: session-scoped client for user CRUD; `getSupabaseAdmin()` (service-role) only in cron/AI/import/admin paths.
5. **Errors**: `{ error }` JSON + correct HTTP status, logged via `logger.error`, never leak stack traces or raw DB errors to the client.
6. **Breaking changes require explicit approval** — extend via additive fields, don't reshape an existing response.

**Public Allowlist** (exhaustive — anything not here needs auth): `POST /api/chat` (rate-limited), proposal share-link routes (`share_token`/`id` as capability token), `POST /api/proposals/track-view`, `/api/whatsapp/webhook` (HMAC, **fails open if `WHATSAPP_APP_SECRET` unset**), `/api/social/webhook/[platform]` (HMAC, fails closed), `GET /api/health`, `/api/cron/*` (`CRON_SECRET` bearer, **fails open if unset**).

Route inventory by group lives in `MASTER_API.md` — check it before adding a route to avoid colliding with a name already reserved by a designed-but-unbuilt growth-platform module (`/api/marketing/*`, `/api/referrals/*`, `/api/reviews/*`, etc.).

---

## 5. Database Conventions

**The one rule that matters most: the live database is the source of truth, not the migration files.** This project has a documented history of live-schema drift (`packages` table columns didn't match its migrations for a period — reconciled by migration 028). **Re-verify against `information_schema.columns` before writing code against any table**, especially ones flagged "unverified" in `MASTER_DATABASE.md`'s migration inventory.

- **Additive-only migrations.** Every migration ships with a paired `_ROLLBACK.sql`. Widening a CHECK constraint (`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`) is the standard pattern for adding a new enum-like value — see migration 038 (drip pause state) or 024 (`ai_interaction_log` interaction types) as references.
- **`activity_logs`/`activity_events`/`analytics_events` overlap is known and accepted** — the direction is to converge additively on `activity_events`, not pick a winner destructively. Default new event-logging to `activity_events` unless there's a specific reason not to.
- **Dormant tables** (`staff_performance`, `ai_summaries`) have schema but no confirmed live writer — check before assuming you need a new table for something that overlaps their purpose.
- **Data Ownership Matrix**: each domain has one authoritative writer service (e.g. catalog tables only ever written via `catalog-service.ts`, never ad hoc from booking code). Check `MASTER_DATABASE.md`'s matrix before writing to a table you don't already own.
- **`leads.source`** is acquisition channel only ("how did the customer arrive"), never a workflow/process label — see `MASTER_DATABASE.md`'s column-semantics section for the incident that established this rule.
- **Degrade gracefully**: services reading from a not-yet-confirmed-live table return a safe default (`[]`, `null`) rather than throwing. Apply this to any new service touching an unverified table.

---

## 6. AI Architecture

**One entry point.** `src/lib/providers/ai-provider.ts` and `chatWithAI()` (`src/lib/ai.ts`) are the only sanctioned paths to a model call. Never import the Anthropic/OpenAI SDK directly outside `src/lib/providers/` (one known legacy exception in `campaigns.ts`, not a pattern to copy). `src/lib/ai/operator-assistant.ts` is a **separate, deliberate** lazy-init Anthropic client for operator-facing single-shot generations (suggested reply, summaries, `runEventSalesAdvisor()`) — distinct from the customer-facing `chatWithAI()` pipeline, which has its own hardcoded `SYSTEM_PROMPT` and ignores caller-supplied context. Know which one you're extending.

**Grounding is the safety property.** Customer-facing answers must be grounded in `knowledge_sources`/`knowledge_chunks`, never invented. Current real gap: retrieval uses keyword `ilike`, not the already-built, unused vector path (`match_knowledge_chunks()` RPC) — the single highest-leverage AI-quality improvement available, per `MASTER_AI.md`. **`SYSTEM_PROMPT` in `src/lib/ai.ts` has hardcoded property facts — never add more; new facts go in `knowledge_sources`.**

**Context**: `src/lib/ai/context-builder.ts` assembles per-customer context once (identity, timeline, history, preferences). Never re-ask information already in its output — that's a regression, not a stylistic choice.

**Logging**: every model interaction writes to `ai_interaction_log` via a CHECK-constrained `interaction_type` enum. A new AI feature needs an additive CHECK-widening migration to log its own interaction type — not a bypass.

**Orchestration**: the proven, live path is Orchestrator → confidence threshold → Human handoff (`ai_active`/`human_active` state, audit-logged). A more sophisticated engine (`orchestration-engine.ts` + friends) exists but is **disabled by default and unproven at production scale** — build against the simpler proven path unless you have a specific, deliberate reason and a rollout plan to enable the other one.

**Safety rules** (non-negotiable): grounded answers only · confidence always logged, thresholds live in `settings` not hardcoded · no autonomous customer-facing sends, ever · every AI write goes through the same validated service layer as a human write (zod/auth-guard/audit-log), no AI-only bypass path.

**Filter-injection lesson**: any code that builds a PostgREST `.or()` filter string from user-supplied text must strip comma/paren characters first (fixed once in `retrieveRelevantKnowledge()` — replicate the sanitization for any new instance of this pattern, don't reintroduce the vulnerability).

---

## 7. WhatsApp Architecture

**Inbound pipeline** (`src/services/whatsapp/process-inbound.ts`, the reference shape every channel adapter should copy): webhook → idempotency check → source detection (`detect-source.ts`) → identity/lead resolution (`lead-resolver.ts`) → message logged → `qualifyLeadFromMessage()` (`auto-qualify.ts`: regex-extracts event details + buying-intent signals, scores the lead via `lead-scorer.ts`, logs a `buying_signal_detected` journey event when intent phrases are found) → `auto-responder.ts` (calls `chatWithAI()`) → activity log.

**Outbound**: `sendWhatsAppText()` (`send-message.ts`) is the one primitive every outbound path uses — campaigns, drip steps, follow-ups, marketing automations. `queue.ts`'s `smartSend()` wraps it with rate-limiting/spam-checking for interactive sends.

**Automated triggers** (`/api/cron/marketing-automations`, once daily): birthday, anniversary, win-back, repeat-booking, referral-request, proposal-expiry (near `expires_at`), and proposal-nudge (`follow_up_now`/`resend_proposal` from `computeProposalUrgency()` — "not opened"/"viewed but inactive"). Each trigger: select candidates → cooldown check against `activity_logs` (`alreadySentWithin()`) → send → log. This check-then-send-then-log idiom is the established dedup pattern for low-frequency (daily) triggers — replicate it for a new trigger, don't invent a second one.

**Drip sequences** (`drip-service.ts`, migrations 037/038): multi-step, delay-based, distinct from a single campaign send. States: `active` → `paused`/`cancelled`/`completed`. `advanceDueDripSteps()` only ever selects `status='active'`, so `paused` is excluded for free. Every write inside its per-enrollment loop is guarded with `.eq('status', 'active')` — a concurrent pause/cancel must never be silently clobbered by the cron's own bookkeeping update; replicate this guard for any new write inside that loop. Exit condition: a lead with a revenue-recognized reservation (`confirmed`/`checked_in`/`checked_out`) auto-cancels its remaining enrollment.

**AI Follow-up Assistant** (`/api/cron/ai-followup-assistant`): drafts AI-recommended follow-up content into `follow_ups` (`status='pending'`, `created_by='ai_followup_assistant'`) for human review at `/dashboard/followups`, drained by `/api/cron/followups` once approved. **`follow_ups.message` is only real customer-facing content when `trigger_reason='ai_followup_assistant'`** — manually-scheduled rows store a placeholder (`'Scheduled follow-up'`) in the same column. Any new code reading this column for sending must check `trigger_reason` first, or it will leak the placeholder to a customer.

**Concurrency rule for anything that sends and then updates state**: claim before you send (conditional `UPDATE ... WHERE status='pending'`, check the row actually matched), not send-then-update — two concurrent requests for the same row must not both pass a check-then-act window. See `send_now` in `/api/followups` as the reference implementation.

---

## 8. Marketing Architecture

**Segments**: `buildSegment()` (`src/lib/campaigns.ts`) is the one segment-resolution function — filters like `upcoming_birthday_days`, `dormant_since_days`, `repeat_customer`. Every automation trigger and campaign send builds its candidate list through this, never a bespoke query.

**Campaigns**: `campaign-scheduler.ts` + `broadcast_campaigns`/`message_queue` — operator-authored, manually-triggered broadcast sends. Distinct from **drip sequences** (pre-authored, multi-step, delay-based, per-lead) and from the **automated triggers** in `marketing-automations` cron (system-initiated, single-message, rule-based) — three different mechanisms for three different jobs; know which one a new requirement actually needs before building.

**Attribution — two distinct concepts, don't conflate them**: `revenueByCampaign` (in `revenue-intelligence.ts`) is OUTBOUND attribution — which broadcast campaign a lead responded to, keyed via `message_queue.metadata.campaign_id`. `campaignPerformance` (same file) is INBOUND attribution — which ad/landing page a lead originated from, reading `leads.campaign`/`utm_*` (migration 026). A dashboard asking "which campaign drove this revenue" needs to know which direction it means.

**Intelligence layer**: `revenue-intelligence.ts` (channel/campaign performance, funnels, forecasting) and `growth-intelligence.ts` (repeat-customer health, dormant-customer opportunities, deterministic AI briefs — template-grounded narrative over already-computed numbers, **not a live LLM call**, same convention as the Founder Dashboard's morning brief). Every number in these briefs must trace to a real computed field; "insufficient data" is the correct output when a real calculation doesn't exist, never a fabricated one.

**No visual Trigger→Condition→Action builder exists.** Every automation (the six original triggers plus proposal-nudge) is code-defined in `marketing-automations/route.ts` — adding a trigger means writing a function there, not configuring one in a UI. If a future requirement needs operator-configurable rules, that's a genuinely new module (a rule schema + evaluator + admin UI), not an extension of the existing cron functions.

---

## 9. Timeline Architecture

`src/lib/timeline/timeline-service.ts` merges every existing record-of-contact table into one chronological view per customer — it **never** introduces a new logging table; it reads and merges what already exists: `conversations` (chat/social), `whatsapp_messages`, `email_log`, `activity_logs` (lead activity/follow-ups), `proposals`, `invoices` (payment), `reservations`, `ai_interaction_log`, `reviews`, `referral_rewards`, `loyalty_transactions`, `message_queue` (campaign), `follow_ups` (call/visit). Each source is fetched independently — a failure or not-yet-live table in one source never blocks the others from rendering.

`src/lib/customers/journey.ts` extends this with **post-booking journey stages** by writing structured events onto the existing `activity_logs` table (`logJourneyEvent()`) rather than a new `journey_events` table — because `timeline-service.ts` already renders any `activity_logs.action` not in its known set generically, a new journey event type shows up on the Timeline with **zero new UI work**. This is the reference pattern for adding any new trackable customer-lifecycle moment: log it via `logJourneyEvent()` with a clear `action` name, don't build a parallel display path. `computeJourneyFunnel()` in the same file reports post-booking stage counts (Review Requested/Completed, Referral Made, Repeat Booking, VIP) — it deliberately does not recompute the pre-booking funnel (Lead→Qualified→Proposal→Booked), which already exists in `revenue-intelligence.ts`'s `computeFunnel()`.

---

## 10. Coding Standards

- **TypeScript strict mode.** ESLint = `next/core-web-vitals` only, no additional custom rules configured — don't assume stricter rules exist than actually do.
- **Result-shaped returns, not thrown exceptions**, for expected failure modes: `{ ok: true; value: X } | { ok: false; error: string }`. Reserve `throw` for genuinely unexpected/programmer-error conditions. This is the dominant pattern — new services should follow it, not reinvent error handling.
- **One zod schema per operation** (`createXSchema`/`updateXSchema`), `.strict()` on anything reaching a DB write directly, called via `parseBody()` — never hand-rolled `req.json()` + manual checks.
- **Mass-assignment protection is two layers**: zod `.strict()` *and* an explicit column allow-list at the service layer for admin-mutable entities — replicate both, not just one.
- **Naming**: `src/lib/<domain>/<name>-service.ts` for services, `<domain>-workflow.ts` for multi-step orchestration spanning services. Providers/adapters live in `src/lib/providers/*` (swap-one-implementation) or `src/lib/social/adapters/*` (many-simultaneous-implementations of one contract) depending on which shape the integration actually is.
- **Logging**: `src/lib/logger.ts`'s structured calls only — `logger.error(scope, message, data)` — never bare `console.*` in feature code. PII goes in the `data` object, never interpolated into the message string (the logger redacts known PII keys in `data`, but does **not** scan interpolated strings).
- **Comments carry real information in this codebase**: they explain *why*, flag what's NOT yet done/safe to assume, and cross-reference the specific file/table/migration a claim depends on. Keep doing this — it's genuinely load-bearing documentation, not decoration.
- **Testing**: colocated `.test.ts` next to the file it tests. Mock at the module boundary (`vi.mock()`/`vi.hoisted()`), exercise the real function. No reliable live-DB access exists in any AI-assisted session on this project — DB constraint behavior (FKs, RLS, CHECK constraints) remains unproven until run against a real Postgres instance.
- **Git discipline**: nothing is "shipped" until it's actually committed and pushed from an environment with real git access — this project has a documented history of work existing only as uncommitted edits.

---

## 11. Extension Points

- **New AI operator action** (e.g. a new suggested-content type): add to `OperatorAssistAction` + `TASK_INSTRUCTION` in `operator-assistant.ts`, reuse `formatContextForPrompt()` and `runOperatorAssist()` — don't stand up a second Anthropic client or a second context formatter.
- **New WhatsApp automation trigger**: add a `runX()` function to `marketing-automations/route.ts` following the existing shape (candidate select via `buildSegment()` or direct query → `alreadySentWithin()` cooldown check → `sendWhatsAppText()` → `logJourneyEvent()`), wire it into `POST`'s try/catch block and the `AutomationCounts` shape.
- **New channel adapter**: conform to the Unified Conversation Engine's inbound pipeline shape (webhook/API → normalize → idempotency key → identity resolution → conversation get/create → message log). One new provider/adapter module under `src/lib/providers/` or `src/lib/social/adapters/`; reuse `chatWithAI()`/`SYSTEM_PROMPT` verbatim — never a channel-specific prompt.
- **New drip step behavior** (branching/conditions): extend `advanceDueDripSteps()`'s per-enrollment loop in `drip-service.ts`, keeping every state-mutating write guarded on the status you actually observed (`.eq('status', 'active')`), so a concurrent pause/cancel is never silently overwritten.
- **New journey/lifecycle event**: call `logJourneyEvent(leadId, action, description, metadata)` from `customers/journey.ts` with a new, clearly-named `action` — it appears on the Customer Timeline automatically, no UI change needed.
- **New admin-mutable entity**: zod `.strict()` schema + a service-layer column allow-list (mirror `catalog-service.ts`), authoritative writer service per `MASTER_DATABASE.md`'s ownership matrix.
- **New DB column/enum value**: additive migration only, paired `_ROLLBACK.sql`. Widening a CHECK constraint: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` with the widened list (see migration 038).

---

## 12. Common Pitfalls

- **Don't trust a migration file over the live database.** This project has shipped a real schema-drift incident (`packages`). Verify against `information_schema.columns` before depending on a column, especially anything flagged "unverified" in `MASTER_DATABASE.md`.
- **RLS won't save an unguarded route.** Most policies are `USING (true)`; a route that forgets `requireAuth()`/`requireRole()` is genuinely open.
- **Check-then-act without a guard is a race, not an edge case.** Any code that reads a row's status, does something external (send a message), then writes a new status must guard that write against the state having changed underneath it (`.eq('status', <expected>)`), or claim before acting, not after. This project has shipped and then had to fix exactly this pattern more than once.
- **`follow_ups.message` is not always customer-facing content** — check `trigger_reason` before sending it verbatim; some rows hold an internal placeholder.
- **Don't conflate `revenueByCampaign` (outbound) with `campaignPerformance`/inbound UTM attribution** — they answer different questions from different tables.
- **Two dormant tables (`staff_performance`, `ai_summaries`) and one three-way overlapping trio (`activity_logs`/`activity_events`/`analytics_events`) already exist** — check them before adding a new table that duplicates their purpose.
- **`src/modules/followups/` (`followup-rules.ts`/`followup-engine.ts`) is largely dead code** — an earlier, never-wired cadence-rule attempt, superseded by `auto-qualify.ts` + `/api/cron/ai-followup-assistant`. Don't build on it assuming it's live; verify call sites first.
- **The orchestration engine (`orchestration-engine.ts` and friends) is disabled by default and unproven** — don't assume it's the active AI path just because it exists in the codebase.
- **`npm run lint`/`npm run build` are known to time out in constrained/sandboxed tooling environments for this project's size** — a timeout is not evidence of a code defect; verify via `tsc --noEmit` output and manual review, and get a real CI/local-machine run before merging regardless.
- **No visual automation builder exists** — every marketing/WhatsApp automation trigger is code, not configuration. Don't assume an operator can add a rule without an engineer.
