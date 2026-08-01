# Omnichannel Communication Platform, Version 2.0 — 2026-08-01

## Scope

Mission: "Regardless of where a customer contacts us, there must be ONE AI, ONE CRM, ONE Customer Timeline, ONE Founder Dashboard." Implementation Mode — reuse everything, no redesign, no duplication, adapters over channel-specific logic.

## What was found (investigation before any code)

Most of the required foundation already existed from an earlier session's Phase 5 (Social Module): `SocialAdapter` contract, `MetaAdapter` (Facebook/Instagram, credential-gated), the social webhook route, `dm-capture-service.ts` (resolves identity, creates/updates a CRM lead, records the inbound message into `unified_conversations`/`unified_messages` — the same tables website chat and WhatsApp mirror into), and a Unified Inbox page/API already reading that same table.

**The one real, confirmed gap:** `captureSocialDirectMessage()` recorded inbound Messenger/Instagram DMs and qualified the lead, but never generated or sent a reply. Website chat (`chatWithAI`) and WhatsApp (a separate deterministic state-machine responder, `auto-responder.ts` — explicitly out of scope to touch, belongs to a concurrent session, and not part of this mission's required channel list anyway) both produce a response; Facebook Messenger and Instagram DM did not, for any message, ever. This directly contradicted the mission's core requirement ("the same AI should work across every channel") for two of the four in-scope channels.

Also found: `/api/inbox` returned lead name/phone/email/status only — missing the mission's required Opportunity Score, Proposal Status, Next Action, and Assigned Owner fields, all of which already exist elsewhere in the codebase (Founder Dashboard) as reusable functions.

Also verified, no gap found: Founder Dashboard reads `leads`/`proposals` with no channel/source filter anywhere — any lead from any channel (including the DM channels this sprint completes) already appears there with zero additional work.

## What shipped

- **`src/lib/social/dm-send.ts`** (new) — `sendMetaDirectMessage()`, the Meta Send API (`POST /me/messages`), credential-gated on `META_PAGE_ACCESS_TOKEN`, same "credential-ready, not live" caveat as `meta-adapter.ts` (never exercised against a real Meta account in any environment this code has run in).
- **`src/lib/social/dm-responder.ts`** (new) — `respondToSocialDirectMessage()`: loads conversation history from `unified_messages`, calls `chatWithAI()` (the exact function/`SYSTEM_PROMPT` website chat uses — no new prompt, no channel-specific instructions), sends the reply via `dm-send.ts`, records it via `recordMessage()`, and runs `checkAndApplyHandoff()` (the same escalation policy already enforced everywhere else). Gated by `unified_conversations.ai_active`, the identical safety check the WhatsApp orchestration path (`whatsapp/webhook/route.ts`) already uses — never replies into a conversation a human has taken over.
- **`src/lib/social/dm-capture-service.ts`** — `CaptureDMResult` extended with `channelId` (previously computed internally but not returned), so the new responder can record its reply without a second, redundant conversation lookup.
- **`src/app/api/social/webhook/[platform]/route.ts`** — one new call, `respondToSocialDirectMessage()`, right after `captureSocialDirectMessage()` succeeds.
- **`src/app/api/inbox/route.ts`** — extended to return `revenueProbability` (`getOpportunityScoreForLead()`), `proposalStatus` (bulk-fetched, latest-per-lead reduced in memory — same pattern Founder Dashboard's own route already uses for the identical need), `nextAction` (`computeIntelligence()`), and `assignedOwner` (`leads.assigned_to`) per conversation. Bounded to the current page's linked leads only — same order-of-magnitude trade-off as Founder Dashboard's own disclosed 12-candidate bound, not a new unbounded query risk.
- **`src/app/(crm)/inbox/page.tsx`** — renders the four new fields; added Facebook/Instagram channel icons (previously fell through to a generic icon).
- **Tests:** `dm-send.test.ts` (5 tests), `dm-responder.test.ts` (7 tests) — covers the reuse claims directly (asserts `chatWithAI` is called with no campaign context, asserts the same escalation function is invoked, asserts the `ai_active` gate blocks a reply). 52 test files / 476 tests total (up from 464), zero regressions.

## What was verified vs. assumed

**Directly verified:** `tsc --noEmit` clean; full `vitest run` green (476/476); `next build` — one full clean completion this session, all routes present including `/api/social/webhook/[platform]` and `/inbox` at its new (slightly larger) bundle size, confirming the new code compiled in.

**Explicitly assumed, not verified:** the Meta Send API request shape in `dm-send.ts` follows Meta's documented contract but has never been exercised against a real Facebook Page/Instagram Business account — no credentials exist in any environment this project has run in (same caveat `meta-adapter.ts` already carries for `publishPost`/`replyToInteraction`). Before this goes live, a real end-to-end message should be sent and confirmed delivered.

## Issues found

None new. This sprint closed a gap (missing AI response) rather than finding a defect in shipped behavior.

## Remaining / follow-up

Out of this sprint's scope, per the mission's own phasing: Google Business Messages and Email Integration (Phase 4) were not started — no existing foundation for either, and building one was judged disproportionate to a single reuse-focused pass. `docs/growth/10_SOCIAL_MEDIA.md`/`11_GOOGLE_BUSINESS.md` remain the design references if that work is picked up later. Real Meta credentials should be configured and a live smoke test run (send a real DM, confirm the AI replies, confirm it appears correctly in the Unified Inbox) before this is relied upon with real customers — see `GO_LIVE_CHECKLIST.md`, which should be updated to include this channel once credentials exist.
