# MASTER_AI.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Canonical AI reference. Consolidates `AI_ARCHITECTURE.md` — that file remains accurate and detailed; this document restates its load-bearing rules as permanent OS policy and adds the growth-platform AI surface from `docs/growth/06_AI_SALES_ASSISTANT.md` and `19_AI_RECOMMENDATIONS.md`.

## Provider layer — the one entry point

`src/lib/providers/ai-provider.ts` (Claude primary, OpenAI fallback, one interface) and `chatWithAI()` in `src/lib/ai.ts` (channel-agnostic, plain message arrays in/text out) are the **only** sanctioned path to a model call anywhere in this codebase. **No feature, present or future, should import an Anthropic or OpenAI SDK directly.** This is enforceable by code review (grep for direct SDK imports outside `src/lib/providers/` and `src/lib/campaigns.ts`'s pre-existing direct Anthropic usage, which is a known, narrow exception worth eventually migrating onto the shared provider, not a pattern to replicate).

## Grounding — the safety-critical part

Target state (partially achieved): every customer-facing AI answer is grounded in CRM-editable content — `knowledge_sources` (migration 012), `knowledge_chunks` (migration 001, vector), `packages.ai_description` (migration 007) — never invented.

**Current, real gap**: retrieval (`src/lib/knowledge/knowledge-retrieval.ts`) uses keyword `ilike` matching, not the vector similarity path that already exists and is unused (`match_knowledge_chunks()` RPC + `ivfflat` index, live since migrations 001/005). Wiring this is the single highest-leverage AI-quality improvement available in this codebase, because it improves every consumer at once (chat, `06_AI_SALES_ASSISTANT.md`'s suggestions, `17_SEO_AND_CONTENT.md`'s content generation) without each needing its own fix.

**Standing rule, not a suggestion**: `SYSTEM_PROMPT` in `src/lib/ai.ts` has hardcoded property facts and package pricing. **Never extend this constant with more hardcoded facts.** New facts belong in `knowledge_sources`. This constant is legacy, on a documented (if not yet executed) path to migration, not a pattern to follow for new content.

## Context & memory

`src/lib/ai/context-builder.ts` assembles per-customer context: identity (`customer_identities`), unified timeline, prior conversations/proposals/reservations, preferences/language/special requests. **Rule**: never re-ask information already on the profile — this is both a UX commitment and a testable behavior (any new AI feature that asks for information already in `context-builder.ts`'s output is a regression, not a stylistic choice).

Every model interaction logs to `ai_interaction_log` (prompt, response, confidence, channel, customer) via a fixed, CHECK-constrained `interaction_type` enum. **Adding a new AI feature that logs a new kind of interaction requires an additive CHECK-constraint extension migration** (the exact, already-proven pattern from migration 024, which added `event_sales_advisor`/`upsell_recommendations` after finding those writes were silently failing against the old constraint) — not a bypass of the logging table.

## Orchestration & human handoff

Every inbound message (any channel) reaches the AI orchestrator after identity resolution. Handoff to a human is triggered by: explicit customer request, confidence below a configurable threshold (in `settings`), complaint/dispute, refund, payment issue, VIP flag, or admin intervention. Handoff payload: full history + AI summary + suggested replies + next-best-actions. States: `ai_active` → `human_active` → `ai_active`, audit-logged.

**A more sophisticated orchestration engine already exists** (`src/lib/ai/{orchestration-engine,orchestration-executor,decision-table,intent-detector,slot-memory,tool-registry}.ts`) but is **disabled by default** (`settings.orchestration.enabled = false`) and has no confirmed production usage history. Treat it as unproven at production scale — new features should call the simpler, proven orchestrator/handoff path described above unless and until the more sophisticated engine has real usage data, per the same reasoning `docs/growth/06_AI_SALES_ASSISTANT.md` already applies.

## Operator Assistant (AI-assisted human chat)

`src/lib/ai/operator-assistant.ts` — suggested replies, rewrite/grammar/translation/shorten/expand, tone adjustment, upsell/cross-sell, next-best-action, plus `runEventSalesAdvisor()` (structured package recommendation). Built and functional; historically lacking a console UI to surface it — closing that gap is `docs/growth/06_AI_SALES_ASSISTANT.md`'s entire scope, and should be treated as a UI project over existing logic, not a new AI-capability project.

## Automation already live

- **Lead extraction** (`src/lib/extract-lead-details.ts`): name, phone, email, event type, guest count, budget, dates, property, requirements → create/update lead via identity resolution, no duplicates.
- **Proposal/package automation**: `src/lib/leads/auto-package-recommendation.ts` runs `runEventSalesAdvisor()` automatically post-qualification and creates a **draft** proposal — never sends anything, always `status: 'draft'`, human-approval-required, consistent with the platform-wide rule below.
- **Scoring/escalation**: `lib/lead-scorer.ts`, `/api/cron/escalations`, `/api/cron/followups`.

## Safety rules (the non-negotiable core of this document)

1. Grounded answers only. If the knowledge base lacks the answer, say so or hand off — never invent pricing, availability, or facts.
2. Confidence is logged on every interaction; thresholds are tunable via `settings`, never hardcoded, so they can change without a deploy.
3. **No autonomous sends of customer-facing documents, payment actions, or destructive CRM changes.** Every AI-drafted proposal, message, or recommendation requires an explicit human click to actually reach a customer or mutate committed state.
4. All AI writes to CRM go through the same validated service layer as human writes — no AI-only write path that bypasses the zod/auth-guard/audit-log conventions in `MASTER_API.md`/`MASTER_SECURITY.md`.

## Known, already-fixed security findings worth remembering as standing practice

- `retrieveRelevantKnowledge()`/`retrieveFromKnowledgeSources()` in `src/lib/ai.ts` build a PostgREST `.or()` filter from keywords derived from raw, public, unauthenticated chat text. This was a real filter-injection vector (comma/paren characters in a chat message could inject extra filter clauses), fixed by stripping those characters before building the filter string. **Any future code that builds a `.or()` filter string from user-supplied text must apply the same sanitization** — this is a pattern to replicate, not a one-off fix.

## Growth-platform AI surface (design-stage, see `docs/growth/`)

- `06_AI_SALES_ASSISTANT.md` — surfacing existing `operator-assistant.ts` in the Inbox.
- `19_AI_RECOMMENDATIONS.md` — generalizing the recommendation pattern (churn-risk, next-best-offer, content topics) beyond package matching, explicitly designed to reuse `ai_interaction_log`'s existing success-rate-tracking pattern rather than inventing a new measurement approach.
- `10_SOCIAL_MEDIA.md`/`17_SEO_AND_CONTENT.md` — AI captions/content generation via the same provider layer.

## Assumptions recorded

- This document assumes the orchestration engine's "disabled by default" state persists until explicitly and deliberately enabled with a rollout plan — no part of this OS assumes it will be turned on as a side effect of unrelated work.
