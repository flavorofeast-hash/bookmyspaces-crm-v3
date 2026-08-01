# 12 — WhatsApp Automation

## Business Objective

WhatsApp is already BookMySpaces' primary conversational channel and already has real automation (a deterministic state machine, not just the AI orchestrator). This module's objective is to extend that automation's *growth* surface — proactive lifecycle/campaign sends, richer qualification — without disturbing the deterministic engine's core promise: **no open-ended AI negotiation on WhatsApp**, an explicit design constraint already stated in the code itself.

## User Journey

A prospect messages "hi" on WhatsApp. Today: `auto-responder.ts`'s deterministic state machine (`ConversationState`, `SourceChannel`) advances the conversation through fixed, pre-written steps — this is intentional, not a gap (see the file's own header: "NO open-ended GPT. NO autonomous negotiation. Pure state-machine → message mapping."). Where the AI orchestrator *is* involved (per `AI_ARCHITECTURE.md`, "every inbound message... goes to the AI orchestrator after identity resolution"), this module's job is to make sure growth-triggered messages (campaigns, journey sends) compose correctly with both the deterministic responder and the AI orchestrator, without either interrupting the other mid-flow.

## Existing Code Reuse

- `src/lib/whatsapp/{auto-qualify,auto-responder,conversation-manager,detect-source,lead-resolver,normalize-phone,send-message,verify-signature}.ts` — the entire deterministic engine already exists and is production-hardened (HMAC signature verification, phone normalization, source detection for attribution).
- `src/lib/queue.ts` — rate limiting (1.5s min delay per phone), spam check (`wasRecentlyContacted()`, 60-minute window), `smartSend()` — this is the one send path every WhatsApp automation in this plan (journey messages, campaigns, this module's own qualification prompts) must go through, never a second ad-hoc sender.
- `lib/templates.ts` (`WHATSAPP_MESSAGES`) — template convention to extend, not replace.
- `constants/conversation-states.ts` (`ConversationState`, `TERMINAL_STATES`) — the state machine's vocabulary; new automation states extend this enum additively.

## Required Database Changes

None required for the core automation — `whatsapp_conversations`/`whatsapp_messages` (legacy, live) and `unified_conversations` (V3) already capture what's needed. If qualification logic needs new persisted fields (e.g., a "qualification score" beyond what `lead-scorer.ts` already computes), extend `leads` additively rather than a parallel WhatsApp-specific table.

## Required APIs

- No new customer-facing routes — `/api/whatsapp/{webhook,send,campaigns}` already cover this surface. Internal: any new automation states are code/config changes to `auto-responder.ts` and `conversation-manager.ts`, not new API surface.

## UI Changes

- Settings page: expose the deterministic state-machine's editable copy (the "Edit copy here to update what users see" comment in `auto-responder.ts` implies this is currently a code change, not an admin-editable field) as an admin-editable template set — genuinely new capability, reusing the `settings`/`ai_prompts` versioned-editor pattern already built for AI prompts.

## AI Opportunities

- Deliberately limited by design, and this module should preserve that: the deterministic responder is not a place to introduce open-ended AI generation. The correct AI opportunity is qualification scoring/routing decisions (already partially present in `auto-qualify.ts`) improving over time, not the conversational copy itself becoming AI-generated.
- Where the AI orchestrator *is* the right tool (post-qualification, free-form questions), it already exists — this module's AI opportunity is making the hand-off between deterministic-responder and AI-orchestrator states clean and observable, not adding new AI surface.

## Risks

- The single clearest risk is architectural regression: any change here that blurs the "deterministic vs. AI" boundary the code currently enforces on purpose would undo a real, intentional safety design (avoiding autonomous negotiation on a channel with real payment/commitment implications). Document any proposed change to this boundary as a product decision, not an incidental refactor.
- Rate-limit/spam-check composition with `08_CUSTOMER_JOURNEY.md` and `09_CAMPAIGN_ENGINE.md`, as already flagged in both those docs.

## Dependencies

- `05_MARKETING_PLATFORM.md`/`09_CAMPAIGN_ENGINE.md` (send infrastructure sharing), `07_OMNICHANNEL.md` (unified timeline visibility of WhatsApp automation).

## Development Priority

**P2** — the core engine is mature; this module is incremental (admin-editable copy, qualification refinement) rather than foundational.
