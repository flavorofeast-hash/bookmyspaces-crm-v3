# ADR-0002 — Chat / Omnichannel Conversation Architecture

**Status:** Accepted (ratifying an already-implemented decision — see "Evidence this is already the real decision" below)
**Date decided:** 2026-07-13 (Product Owner sign-off, per `audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md`'s "Open Decisions" section); formalized as a numbered ADR here.

**A note on numbering:** the repository's only existing ADR set is `ADR-001`–`ADR-011` in `audit/CRM_DOMAIN_ARCHITECTURE_V1_ADR.md`, a 3-digit scheme scoped to CRM domain-model decisions (Contact/Lead shape, consent modeling, campaign structure). No `ADR-0001` exists under a 4-digit scheme. This document uses the identifier requested — `ADR-0002` — and is written as the second entry in what should become a separate, cross-cutting **platform-architecture** ADR series (chat, reservations, pricing, AI), distinct from the CRM-domain set. Recommend reserving `ADR-0001` retroactively for the Reservation Platform's foundational decisions (property/inventory-item modeling, reservation state machine) the next time that's written up, rather than leaving a gap in the sequence.

---

## Context

Three chat/conversation data models exist in this codebase today:

1. **`conversations` + `messages`** (migrations 001, 009) — website chat only. `conversations.messages` stores an inline JSONB array; a separate, normalized `messages` table was added later referencing the same `conversation_id`. Both are live and in use.
2. **`whatsapp_conversations` + `whatsapp_messages`** (migration 009) — WhatsApp only, phone-keyed, with its own linear intake state machine (`NEW_INQUIRY → ... → HANDOFF_TO_OPERATOR`). Live and in use.
3. **`channels` / `unified_conversations` / `unified_conversation_channels` / `unified_messages`** (migration 012, drafted, not yet applied to production) — a single, channel-agnostic conversation model keyed by `customer_id`, not by channel or phone number.

Model (1) and (2) cannot represent a customer who contacts the business on more than one channel as a single conversation — a customer who messages on WhatsApp and later fills the website form today produces two disconnected records with no shared identity beyond a loose phone/email match. This is the specific, evidenced problem the unified model exists to solve, not a speculative one: `audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md` Section 6 documents today's identity resolution as "single-key (`leads.phone` for WhatsApp, ad-hoc phone/email scan for website chat)."

## Decision

**Adopt the migration-012 unified schema (`channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages`) as the target chat architecture, migrated in additively via dual-write — not a cutover.**

Specifically:

- `unified_conversations` is keyed by `customer_id` (→ `leads.id`, consistent with ADR-001 in the CRM-domain set: no parallel `customers` table), not by channel. One customer, one conversation record, N channel touchpoints via `unified_conversation_channels`.
- Identity resolution generalizes `resolveIdentity()`'s existing phone-primary/email-secondary logic to a `customer_identities`-backed multi-identifier lookup (`phone | email | whatsapp_id | facebook_psid | instagram_igsid`), rather than each channel doing its own ad-hoc matching.
- Channel adapters (one per channel: WhatsApp, website chat, Facebook, Instagram, email, SMS — see `src/types/conversation.ts`'s `ChannelType`) all write through one shared service (`src/lib/conversations/unified-conversation-service.ts`), never directly to `unified_messages`. Adding a channel means writing one adapter, not touching the orchestrator or CRM.
- **Migration strategy is additive-first, dual-write, no big-bang cutover** (per `audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md` Section 14, restated here as the binding decision): old tables (`conversations`, `whatsapp_conversations`) are never dropped in this plan; new channel traffic writes to both old and new schemas during the transition; each old-table-reading feature migrates to reading from the unified schema one at a time, verified working, before the next one starts. Rollback at any point = stop writing to the new tables, keep reading the old ones.

### Evidence this is already the real decision, not a proposal

This ADR is ratifying work that is already built, not proposing new work:

| Piece | File | Status |
|---|---|---|
| Unified conversation service | `src/lib/conversations/unified-conversation-service.ts` | Written, unit-tested (`unified-conversation-service.test.ts`) |
| WhatsApp → unified mirror | `src/lib/conversations/whatsapp-unified-sync.ts` | Written — every WhatsApp send/receive is mirrored into `channels`/`unified_conversations`/`unified_messages` alongside the legacy `whatsapp_conversations`/`whatsapp_messages` write, exactly matching the dual-write strategy above |
| Website chat → unified | `src/app/api/chat/route.ts` | Already calls `handleInboundMessage()`/`recordMessage()` from the unified service |
| Outbound dispatch | `src/lib/conversations/outbound-dispatcher.ts` | Written |
| AI context assembly | `src/lib/ai/context-builder.ts`, `src/lib/ai/orchestrator.ts` | Written, unit-tested, reads unified conversation data |
| Unified Inbox | `src/app/(crm)/inbox/page.tsx` + `src/app/api/inbox/*` (list, thread, reply, AI-assist routes) | Written, full CRUD/reply UI |

Facebook, Instagram, email, and SMS adapters are typed (`ChannelType` already lists them) but have no adapter implementation yet — consistent with the original review flagging Google Business Profile and LinkedIn as at-risk/deferred and recommending email be built last, after the pattern proves out on push channels. This is intentional sequencing, not an oversight.

**Blocker:** identical to the Reservation Platform's — none of this has run against a live database. Migration 012 is not yet applied to production (same migration, same blocker, same `npm run db:migrate:v3` tooling already covers both). Nothing in the unified conversation code path can be exercised end-to-end until that migration lands.

### A discrepancy worth surfacing, not papering over

`audit/CRM_DOMAIN_ARCHITECTURE_V1_ADR.md` (a later document) contains a numbered recommendation: *"Adopt migration 012's `unified_conversations` schema once Email or SMS sending is actually being built — not before."* That recommendation has already been overtaken by events — WhatsApp and website chat adoption happened first, per the evidence table above, not gated on Email/SMS. This isn't a conflict to resolve by picking a side; it's a stale caution note in an earlier document that this ADR supersedes for the chat-architecture question specifically. **Recommendation:** update that line in `CRM_DOMAIN_ARCHITECTURE_V1_ADR.md` to point at this ADR rather than leaving two documents giving different guidance on the same question.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Keep `conversations` and `whatsapp_conversations` as permanently separate, channel-specific tables | Does not solve the stated problem (cross-channel identity/conversation merging) at any point — not a phased step toward a solution, a permanent non-solution |
| Big-bang cutover: migrate all channels to the unified schema in one deploy | Rejected by the original review's Section 14 explicitly, for the same reason the Reservation Platform and every migration on this project uses additive, verified, one-feature-at-a-time rollout — a single cutover risks losing live chat history/state with no rollback path |
| A `customers` table separate from `leads`, with conversations keyed to it | Reopens the settled 2026-07-13 leads-vs-customers decision (ADR-001, CRM-domain set); `unified_conversations.customer_id` already correctly points at `leads.id` |

## Consequences

- Any future channel (Facebook, Instagram, email, SMS, and whatever comes after) is a new adapter file against an existing interface, not a new conversation table and a new set of CRM integrations.
- The Reservation Platform's Timeline integration (`src/lib/timeline/timeline-service.ts`) already reads `reservations` directly and will pick up unified conversation activity the same way once migration 012 is live — no additional wiring needed, already verified in `audit/RESERVATION_BOOKING_ARCHITECTURE_AUDIT.md`.
- `conversations`/`whatsapp_conversations` remain the system of record until each reading feature (Dashboard, Kanban, existing WhatsApp campaign tools) is individually migrated to the unified schema — until then, some CRM screens will show pre-unification data while the Inbox shows unified data. This is an accepted, temporary, documented inconsistency, not a bug.
- No AI/Omnichannel feature built after this ADR should introduce a new, parallel conversation-storage shape — extend `unified_messages`/`unified_conversations`, per the pattern already established.
