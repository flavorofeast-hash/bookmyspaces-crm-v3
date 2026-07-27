# AI_ARCHITECTURE.md

Last updated: 2026-07-27 (Release Candidate hardening pass).

## Provider Layer

`src/lib/providers/ai-provider.ts` — Anthropic Claude primary, OpenAI fallback, behind a single interface. `chatWithAI()` in `src/lib/ai.ts` is the one channel-agnostic model entry point (plain message arrays in, text out). All new AI features call through these; no direct SDK usage elsewhere.

## Grounding (Knowledge Base)

Target state: every customer-facing answer grounded in CRM-editable content — `knowledge_sources` (migration 012) + `knowledge_chunks` (001) + `packages.ai_description` (007), retrieved via the existing-but-unwired vector path (`vector` column, ivfflat index, `match_knowledge_chunks()` RPC from 001/005).

Current gaps (Phase 1/3 work):
- Retrieval (`src/lib/knowledge/knowledge-retrieval.ts` / `retrieveRelevantKnowledge()`) uses keyword `ilike`, not the vector RPC → wire real RAG.
- `SYSTEM_PROMPT` in `src/lib/ai.ts` hardcodes property facts and package pricing (Silver/Gold/Platinum) → migrate content into `knowledge_sources`; prompts become DB-driven via `ai_prompts` (versioned). Never extend the hardcoded constant.
- `packages.ai_description` is never read by code → include in retrieval corpus.

## Context & Memory

`src/lib/ai/context-builder.ts` assembles per-customer context: identity (`customer_identities`), unified timeline (`timeline-service`), prior conversations/proposals/reservations, preferences/language/special requests. Rule: never re-ask information already on the profile. All model interactions logged to `ai_interaction_log` (prompt, response, confidence, channel, customer).

## Orchestration & Handoff

AI-first: every inbound message (any channel) goes to the AI orchestrator after identity resolution. Handoff to human when: customer asks, confidence < threshold (configurable in `settings`), complaint/dispute, refund, payment issue, VIP flag, admin intervention. Handoff payload: full history + AI summary + suggested replies + next best actions. Humans can pause/resume AI per conversation. States: `ai_active` → `human_active` → `ai_active` (audit-logged transitions).

## Operator Assistant (AI-assisted human chat)

`src/lib/ai/operator-assistant.ts` (built, awaiting console UI — Phase 3): suggested replies, rewrite, grammar, translation, shorten/expand, tone (professional/friendly), upsell/cross-sell, next best action. Human always has final control.

## Automation

- **Lead extraction** (`src/lib/extract-lead-details.ts`, hardened cross-channel in Phase 3): name, phone, email, event type, guest count, budget, dates, property, requirements → create/update lead via identity resolution (no duplicates).
- **Proposal automation:** when required fields are gathered, AI recommends generate-proposal / brochure / WhatsApp-or-email send / site visit / follow-up. **Human approval is required before any customer-facing document is sent.**
- **Scoring/escalation:** lead scorer (`lead-scorer.ts`), escalation cron (`/api/cron/escalations`), follow-up cron.

## Safety Rules

1. Grounded answers only; if the knowledge base lacks the answer, say so / hand off — don't invent pricing or availability.
2. Confidence logged on every interaction; thresholds tunable without deploys (settings).
3. No autonomous sends of documents, payments actions, or destructive CRM changes.
4. All AI writes to CRM go through the same validated service layer as human writes.

## Direct Event Sales Engine (shipped since the note above was written)

- **AI Event Sales Advisor** (`runEventSalesAdvisor()`, `src/lib/ai/operator-assistant.ts`): given a lead's event_type/guest_count/budget, recommends a structured package match from the live `packages` table (post-023, including hall/AV/seasonal-pricing fields). Logged to `ai_interaction_log` with `interaction_type: 'event_sales_advisor'`.
- **Automatic Package Recommendation + Proposal Suggestion** (`runAutoPackageRecommendation()`, `src/lib/leads/auto-package-recommendation.ts`): runs automatically after AI qualification when a lead's event_type is known; self-gates (skips if no signal, or a proposal already exists) rather than spamming a recommendation on every message.
- **AI Recommendation Success Rate** (Revenue Dashboard, `revenue-intelligence.ts`): closes the loop — compares each recommendation's `packageId` against the package on that same lead's eventually-accepted proposal, computed via a single in-memory pass (no per-recommendation query), never fabricates a rate when there's no accepted-proposal data yet.
- **Upsell recommendations** (operator-assist action): logged with `interaction_type: 'upsell_recommendations'`. Migration 024 fixed a real bug where both this and the Event Sales Advisor's writes to `ai_interaction_log` were silently failing — the CHECK constraint from migration 012 never included these two values.

## RC Hardening Pass — AI-surface security fixes

Found and fixed during the Release Candidate security review (`SECURITY_REVIEW.md` has full detail):

- `retrieveRelevantKnowledge()` / `retrieveFromKnowledgeSources()` (`src/lib/ai.ts`) build a PostgREST `.or()` filter string from keywords derived directly from raw customer chat text — reachable from the public, unauthenticated `/api/chat` route. Comma/paren characters in a chat message could inject extra filter clauses. Fixed by stripping those characters from every keyword before it reaches the filter string.
- `/api/chat` and `/api/whatsapp/webhook` both have rate limiting (`checkRateLimit`, `src/lib/rate-limit.ts`) — the WhatsApp webhook didn't previously; added this pass for parity with the social webhook, which already had it.
