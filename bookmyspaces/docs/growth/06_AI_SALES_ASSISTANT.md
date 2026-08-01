# 06 — AI Sales Assistant

## Business Objective

Put the AI capability that already exists (`operator-assistant.ts`) directly into the operator's actual working surface — the inbox — so every reply, proposal, and follow-up is AI-assisted by default, the way Salesforce Einstein/Copilot sits inside the seller's own screen rather than a separate tool. This module is almost entirely about **surfacing** existing, already-built logic, not writing new AI capability.

## User Journey

An operator opens a conversation in the Inbox. Alongside the message thread, a panel shows: a suggested reply (grounded, per `AI_ARCHITECTURE.md`'s safety rules), a one-click "improve tone" / "translate" / "shorten" action on their own draft, and a "next best action" recommendation (e.g. "recommend the Platinum package" or "this lead is 3 days cold, send a follow-up"). The operator edits or accepts — nothing sends without a human click, per the existing "human approval required before any customer-facing document" rule.

## Existing Code Reuse

- `src/lib/ai/operator-assistant.ts` — already implements suggested replies, rewrite, grammar, translation, shorten/expand, tone, upsell/cross-sell, next-best-action, and `runEventSalesAdvisor()`. This module is UI work over this file, not new AI logic.
- `src/lib/ai/context-builder.ts` — already assembles the per-customer context (identity, timeline, prior conversations/proposals/reservations) this assistant needs; reused as-is.
- `src/lib/leads/auto-package-recommendation.ts` — the automatic (non-button-triggered) half of package recommendation already exists; this module's UI complements it with an on-demand, in-conversation version.
- `ai_interaction_log` — every suggestion this module surfaces should log here with `interaction_type` values already defined (`suggested_whatsapp_reply`, `suggested_email`, `recommended_package`, `upsell_recommendations`, `event_sales_advisor`, etc. — migration 024's CHECK constraint already includes these), not a new logging table.

## Required Database Changes

None required to launch — every backing table (`ai_interaction_log`, `knowledge_sources`, `ai_prompts`) already exists and already supports these interaction types (post migration-024's CHECK-constraint fix). Optional: an `ai_suggestion_feedback` column/table (accepted/edited/rejected per suggestion) if usage analytics beyond what `ai_interaction_log` captures becomes a priority — deferred, not required for v1.

## Required APIs

- Largely already exists: `/api/customers/[id]/ai` and `/api/inbox/[id]/ai` are already listed in the route inventory (`API_SPECIFICATION.md`). This module's API work is closing whatever gap exists between what those routes currently return and what a live in-inbox panel needs (verify current response shape against the panel's needs before adding new endpoints — likely additive fields, not new routes).

## UI Changes

- Inbox page (`src/app/(crm)/inbox/page.tsx`): add a persistent side panel per open conversation, wired to the existing AI routes above.
- Customer detail page: surface `runEventSalesAdvisor()`'s recommendation inline (today reachable via a button per `AI_ARCHITECTURE.md` — confirm current state before assuming it needs to be built from scratch).

## AI Opportunities

- This entire module *is* the AI opportunity — the opportunity is exposure, not new capability. The one genuine net-new AI opportunity: a lightweight "why this suggestion" explanation surfaced alongside each recommendation, using the same context-builder output, so operators trust and adopt the tool (a known SFDC/HubSpot copilot adoption blocker is "black box" suggestions).

## Risks

- Orchestration engine (`orchestration-engine.ts`) is disabled by default and unproven at scale (`04_GAP_ANALYSIS.md` Section C) — this module should call `operator-assistant.ts` functions directly, not route through the orchestration engine, until that engine has production usage history.
- Suggestion quality is bounded by the grounding gap already flagged (`04_GAP_ANALYSIS.md` A5 — vector RAG unused) — expect noticeably better suggestions once that's wired, not a reason to block this module on it.

## Dependencies

- `07_OMNICHANNEL.md` (the Inbox this panel lives in), A5 (grounding quality) and A6 (conversation cutover) in `04_GAP_ANALYSIS.md`.

## Development Priority

**P1** — highest ratio of business value to engineering effort in this entire document set, since the AI logic is already built and tested; this is primarily a focused UI sprint.
