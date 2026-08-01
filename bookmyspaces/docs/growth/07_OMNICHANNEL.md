# 07 — Omnichannel (Unified Inbox Cutover)

## Business Objective

Finish what `IMPLEMENTATION_ROADMAP.md` Phase 2 already started: one inbox, one customer timeline, regardless of whether the message came from WhatsApp, website chat, or (once built) social DMs/email. This is a completion module, not a new-build — the architectural keystone is already in place.

## User Journey

An operator opens one Inbox page and sees every conversation — WhatsApp, website chat, and eventually Instagram/Facebook DM and inbound email — as one list, sorted by recency/urgency, each item showing the channel badge and linking to one customer profile with one timeline. No more checking a separate WhatsApp page and a separate Inbox page for the same customer.

## Existing Code Reuse

- `unified_conversations`, `unified_conversation_channels`, `unified_messages`, `customer_identities`, `channels` (all migration 012) — the entire schema for this already exists.
- `src/lib/conversations/{unified-conversation-service,outbound-dispatcher,whatsapp-unified-sync}.ts` — per `CHANGELOG.md`, WhatsApp already mirrors inbound+outbound into this system, and website chat does too. The dual-write is already happening.
- `src/lib/identity/resolve-identity.ts` — multi-identifier resolution already built; per `BOOKMYSPACES_V3_MASTER_SPECIFICATION.md` it is "built, not wired into live webhook paths" for some channels — closing that wiring gap is this module's core work, not a redesign.
- `src/lib/timeline/timeline-service.ts` — already reads `reservations` and `activity_logs` for the customer timeline; extending it to read `unified_messages` too (if not already done) is additive.
- Inbox page + `/api/inbox*` — already exist per `API_SPECIFICATION.md`'s route inventory and `CHANGELOG.md`'s Phase 3 note (reply auto-pauses AI, pause/resume, escalation states already wired).

## Required Database Changes

None — this module's entire job is retiring reliance on legacy tables (`conversations`, `whatsapp_conversations`, `whatsapp_messages`), not adding to the schema. Per `DATABASE_ARCHITECTURE.md` Rule/Legacy note: those tables are kept read-only for history, never dropped without explicit approval.

## Required APIs

- Verify (not assume) current completeness of `/api/inbox`, `/api/inbox/[id]`, `/api/inbox/[id]/reply` against the "every channel, one list" requirement — the routes exist per the inventory, but whether they currently merge legacy-table history alongside `unified_messages` needs direct verification against current code, since that's exactly the kind of "presumed done" gap this session's testing repeatedly found elsewhere (BUG-001, BUG-003).
- New channel adapters (social DM, email-in) plug into the existing dispatcher pattern (`outbound-dispatcher.ts`) rather than each needing a bespoke send path — see `10_SOCIAL_MEDIA.md`, `13_EMAIL_MARKETING.md`.

## UI Changes

- Consolidate the separate WhatsApp page (`src/app/(crm)/whatsapp/page.tsx`) into the Inbox once parity is confirmed — or explicitly keep it as a WhatsApp-specific operational view if there's a real reason operators need a channel-filtered view (decide with actual usage data, don't assume consolidation is strictly better).
- Channel badges/filtering in the Inbox list.

## AI Opportunities

- Once every channel lands in one timeline, `06_AI_SALES_ASSISTANT.md`'s context-builder gets strictly better context (a customer's Instagram DM history informs a WhatsApp reply suggestion) — this module is a force-multiplier for the AI module, not just an operational nicety.

## Risks

- The exact risk `04_GAP_ANALYSIS.md` A6 already names: building new features (this module, plus `08`/`10`) on an *incomplete* cutover means reading from two systems and reconciling them, which is real complexity this plan should not hide. Recommend a hard parity-verification step (dual-write comparison over a real time window) before retiring any legacy read path, exactly as `IMPLEMENTATION_ROADMAP.md` Phase 2 already specifies ("dual-write → parity verification → retire legacy write paths").

## Dependencies

- Blocks: `10_SOCIAL_MEDIA.md`'s DM inbox (explicitly designed in `SOCIAL_MEDIA_ARCHITECTURE.md` to "ride" these adapters), `08_CUSTOMER_JOURNEY.md`'s cross-channel journey messaging.
- Blocked by: nothing new — this is the highest-leverage "finish it" item in the whole plan.

## Development Priority

**P0 (do first)** — every other channel-facing module in this document set (AI assistant UI, social DM inbox, journey messaging) is more valuable and less risky once this cutover is actually finished rather than half-done.
