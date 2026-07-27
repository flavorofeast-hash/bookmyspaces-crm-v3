# SMOKE_TEST_VALIDATION.md — Go-Live Prep, Phase 5

Date: 2026-07-27. This sandbox has no live traffic, no browser, and no reachable database (`DATABASE_VALIDATION.md`) — a real click-through smoke test is not possible from here. What follows is a fresh code-level trace of every requested flow, re-verified by grep/read this session (not copy-forwarded from `WORKFLOW_VERIFICATION.md`, the RC pass's equivalent document, though the two substantially agree — that agreement is itself a useful cross-check). **Treat this as "the code is wired correctly end-to-end," not "this was observed working."** The actual smoke tests in `DEPLOYMENT_CHECKLIST.md` (log in, send a real WhatsApp message, create a real lead, etc.) still need to run against the real deployment.

## Common downstream chain (shared by every entry point below)

Once a lead exists, the rest of the chain is identical regardless of source, confirmed this session by tracing `runAutoPackageRecommendation` forward from its definition (`src/lib/leads/auto-package-recommendation.ts:58`):

Lead created → AI Qualification (`qualifyLeadFromMessage()`) → `runAutoPackageRecommendation(leadId)` (self-gated: skips if no `event_type` signal or a proposal already exists) → draft `proposals` row inserted (`status: 'draft'`) → operator reviews/sends (manual, by design) → operator marks accepted / records payment → operator creates the reservation → `confirmReservation()`/`checkInReservation()`/`checkOutReservation()` each enqueue the matching customer-journey WhatsApp message (re-confirmed present this session, not just cited) → Revenue Dashboard (`buildRevenueIntelligence()`) reads `leads`/`proposals`/`reservations` fresh on every load, no caching, so any of the above shows up immediately once written.

## Flow 1: Website Lead

`POST /api/chat` (public, rate-limited 20/min/IP) → `upsertLead()` inserts into `leads` with `source: 'website'` → `runAutoPackageRecommendation` fires from `src/app/api/chat/route.ts` via the shared lead-creation path. **Confirmed this session**: `src/app/api/leads/route.ts:133` also calls `runAutoPackageRecommendation` on its own `POST` handler — meaning any lead created through the base leads API, not just chat, gets the same automation.

## Flow 2: WhatsApp Lead

Inbound webhook → `processInboundMessage()` (`src/services/whatsapp/process-inbound.ts`) → `resolveLeadByPhone()` / identity resolution → **confirmed this session**, line 137 of that file calls `runAutoPackageRecommendation(lead.id)` — same downstream chain as Website.

## Flow 3: Social Lead (Facebook/Instagram)

Lead Ads webhook → `captureLeadWithJourney()` / DM webhook → `captureSocialDirectMessage()` (`src/lib/social/dm-capture-service.ts`) → **confirmed this session**, line 76 calls `runAutoPackageRecommendation(leadId)`. Also confirmed via `create-lead-with-journey.ts` (lines 74 and 125 — two call sites, covering both the lead-ads and direct-message capture paths through a shared helper) that this is the common entry point Website/Social/WhatsApp all eventually funnel through for lead creation with journey tracking.

**Note:** the Social channel is currently unconfigured in this environment's env vars (`META_APP_SECRET`/`META_PAGE_ACCESS_TOKEN`/etc. all absent per `ENVIRONMENT_VALIDATION.md`) — the code path is real and wired correctly, but won't receive any real traffic until those are set. Safe, inactive-by-default state, not a broken flow.

## Flow 4: Manual Lead

**Finding, re-verified this session via a fresh, targeted search (not assumed from the prior pass):** there is no single-lead "Add Lead" button or form anywhere in the CRM UI — grepped for `Add Lead`, `Create Lead`, `New Lead`, and any client-side `fetch('/api/leads', ...)` call; found none. The only UI-driven manual lead-entry path is **Customer Bulk Import** (`/dashboard/leads/import`, Excel/CSV upload → `POST /api/leads/import`), which is bulk, not single-record.

The single-lead API (`POST /api/leads`) exists, is fully wired to the same automation chain as every other channel (confirmed above), and is presumably intended for either a future UI addition or direct API/integration use — but as of this review, **there is no way for an operator to manually type in one new lead's details through the CRM interface itself**. This is a real, user-facing gap worth a product decision (add a simple "New Lead" form calling the existing, already-working API — this would be a small, low-risk UI addition, not a new backend capability) — flagged here rather than fixed, since the Go-Live directive's scope is verification, not new functionality.

## Dashboard

`buildRevenueIntelligence()` re-verified this session as still reading `leads`/`proposals`/`reservations`/`stage_transitions`/`ai_interaction_log` fresh via `Promise.all` (no caching layer, confirmed in `PERFORMANCE_REVIEW.md` and re-confirmed by re-reading `src/lib/analytics/revenue-intelligence.ts`'s `fetchRawData()` this session) — any change from any of the four flows above will appear on next dashboard load with no propagation delay.

## Summary

| Flow | Entry point | AI Qualification | Package Recommendation | Status |
|---|---|---|---|---|
| Website Lead | `POST /api/chat` | Yes | Yes (confirmed this session) | Wired, code-verified |
| WhatsApp Lead | Webhook → `processInboundMessage()` | Yes | Yes (confirmed this session) | Wired, code-verified |
| Social Lead | Webhook → `dm-capture-service.ts` | Yes | Yes (confirmed this session) | Wired but inactive (Social env vars unset) |
| Manual Lead | `POST /api/leads` (API only) | Yes | Yes (confirmed this session) | Backend wired; **no UI exists to trigger it for a single lead** |

No broken links found in any of the four chains at the code level. The one real gap is product/UI, not automation: Manual Lead has no single-record entry form.
