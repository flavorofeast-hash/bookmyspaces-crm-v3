# End-to-End Workflow Verification — BookMySpaces CRM V3

Traced from code (not a live-data test — this sandbox has no database access). Each step below cites the actual function/route that performs it.

## Primary pipeline: Enquiry -> Lead -> AI Qualification -> Package Recommendation -> Draft Proposal -> Approval -> Reservation -> Customer Journey -> Revenue Dashboard

| Step | Trigger | Automatic? | Code |
|---|---|---|---|
| Website enquiry -> Lead | Form submit | Automatic | `POST /api/leads` |
| Social (FB/IG Lead Ads, Messenger, IG DM) -> Lead | Webhook | Automatic | `captureLeadWithJourney()`, `captureSocialDirectMessage()` |
| WhatsApp Click-to-Chat -> Lead | Inbound message | Automatic | `processInboundMessage()` -> `resolveLeadByPhone()` |
| Duplicate detection | Every capture path | Automatic | `resolveIdentity()` — phone normalized via `normalizePhone()` before matching (fixes a real Sprint 5 bug where differently-formatted phone strings didn't match) |
| AI Qualification | After lead create/re-engage | Automatic | `qualifyLeadFromMessage()` — extraction + scoring, safe-fill only |
| Package Recommendation | After qualification, if `event_type` known | Automatic (self-gated) | `runAutoPackageRecommendation()` — calls the AI Event Sales Advisor, skips if no signal or a proposal already exists |
| Draft Proposal | AI names a confident package match | Automatic | Same function, inserts `proposals` row with `status: 'draft'` — never sent |
| Proposal review & send | Operator | **Manual, by design** | Operator reviews the draft in the Proposals UI, edits if needed, sends via WhatsApp/email |
| Proposal Approval | Customer confirms (WhatsApp/phone/email), operator records it | **Manual, by design** | "Mark as Accepted" in `proposals/page.tsx`, or implicitly when a payment is recorded (`proposals/[id]/payment/route.ts`) |
| Reservation creation | Operator, from the accepted proposal | Manual | Reservations UI |
| Customer Journey | Reservation status changes | Automatic | `confirmReservation()`/`checkInReservation()`/`checkOutReservation()` each enqueue the matching WhatsApp message |
| Revenue Dashboard | Reads `proposals`/`reservations` | Automatic (on page load) | `buildRevenueIntelligence()` |

**There is no customer-facing self-service "Accept Proposal" button.** The share link (`/proposals/share/[token]`) is read-only — confirmed by grep, zero POST/PATCH calls in that page or its API route. Approval is always operator-mediated (verbal/WhatsApp confirmation, then a manual CRM action). This is a reasonable, deliberate safety design for a business handling real bookings and money — flagged here as a known characteristic, not a defect, but worth knowing before assuming the funnel is fully self-service.

## Secondary workflows

- **WhatsApp:** inbound webhook -> `processInboundMessage()` -> auto-response, qualification, package recommendation, CRM timeline. Outbound sends go through `smartSend()`/`message_queue`, retried up to `MAX_RETRIES`, logged to `whatsapp_messages` with `lead_id` populated (fixed this session — previously queue-based sends left `lead_id` null, making them invisible on the Timeline).
- **Social Inbox:** Unified Conversation Platform (`unified_conversations`/`unified_messages`, migration 012) mirrors WhatsApp, Messenger, and Instagram DM into one inbox.
- **Marketing Campaigns:** queue-based send/pause/resume/cancel, recurring campaigns via `advanceRecurringCampaigns()` (hourly cron), `{{name}}` placeholder substitution.
- **Customer Journey Automation:** all 9 stages live — Welcome, Proposal Reminder, Booking Confirmation, Pre-arrival, Check-in, Check-out, Thank-you, Review Request, Win-back (fully automatic, seeded recurring campaign, migration 022).
- **Win-back:** recurring `broadcast_campaigns` row, `dormant_since_days: 60`, weekly.
- **Follow-ups:** `cron/followups` + `api/followups`, cadence keyed by `lead_temperature` (`CADENCE_RULES`).
- **Proposal Sharing:** `share_token` (UUID, no dashes) generated on every proposal; `expires_at` supported; read-only for the customer (see above).
- **Duplicate Detection:** `resolveIdentity()`, phone-normalized exact match, email as secondary/possible-duplicate signal (not auto-merged, flagged in `activity_logs.metadata`).
- **Repeat Customer Flow:** `computeCustomerAnalytics()`/`computeSalesProductivity()` in Revenue Intelligence count repeat bookings per customer; Win-back automation targets dormant (not repeat) customers — there is no separate "repeat customer" nurture campaign distinct from the general Customer Journey, which is a reasonable scope boundary, not a gap.

## Issues found during this trace

1. **Stray dead file**: `src/app/api/proposal/share/[token]/api--proposal--share--token--route.ts` — a wrongly-named copy of `route.ts` in the same folder, self-documented in its own header as superseded/dead (`ISS-020, 2026-07-11`) and never loaded by Next.js's router (wrong filename). Confirmed still present; left in place because this sandbox's mount does not permit file deletion (same constraint hit elsewhere this session) — safe to delete manually.
2. **No self-service proposal acceptance** — documented above, not a blocker, worth a product decision before/after launch.
