# 08 — Customer Journey Automation

## Business Objective

Automate the lifecycle messages a hospitality business should never miss — booking confirmed, pre-arrival reminder, check-in welcome, post-stay thank-you, review request, win-back after a dormancy window — triggered by CRM state changes (`reservations.status` transitions, `stage_transitions`), not by an operator remembering to send them. Per `AI_ARCHITECTURE.md`, some of this already exists (`confirmReservation()`/`checkInReservation()`/`checkOutReservation()` in `reservation-workflow.ts` already fire WhatsApp messages via `WHATSAPP_MESSAGES`); this module generalizes and extends the pattern rather than introducing a new automation system.

## User Journey

A guest's reservation moves from `confirmed` → `checked_in` → `checked_out`. Without any operator action: a confirmation message fires on booking (already live), a check-in welcome fires on check-in (already live), a check-out farewell fires immediately (already live), and — net new — a "how was your stay" review-request message fires 24 hours after check-out, and a "we miss you" win-back message fires if no new reservation exists 90 days after a prior stay (the seed for this already exists: migration 022's recurring win-back campaign row).

## Existing Code Reuse

- `src/lib/reservations/reservation-workflow.ts`'s `confirmReservation()`, `checkInReservation()`, `checkOutReservation()` — each already calls `logActivity()` and fires a WhatsApp message via `enqueueMessage()`/`WHATSAPP_MESSAGES`. This is the exact pattern to extend for review-request and win-back, not a new trigger mechanism.
- `src/lib/queue.ts` — rate-limited, spam-checked outbound queue already in place; new lifecycle messages are just new `enqueueMessage()` calls.
- `stage_transitions` (migration 019) — already captures funnel timing; a scheduled job checking "checked_out N days ago, no follow-up sent" is a straightforward query against this plus `reservations`.
- `/api/cron/stay-lifecycle` — **already exists** per the route inventory in `API_SPECIFICATION.md`. This module's cron work should start by reading what this route currently does before assuming it needs to be built — it may already be partially or fully this feature.
- `lib/templates.ts` — WhatsApp message template convention (`WHATSAPP_MESSAGES` object) to extend with `reviewRequest()`/`winBack()` templates, not a new template system.

## Required Database Changes

- Additive: a `journey_sends` table (or reuse `message_queue.metadata` — decide based on whether idempotency tracking needs richer state than metadata provides) to prevent double-sending the same lifecycle message if the cron job runs more than once for the same reservation.
- No changes to `reservations`/`leads` schemas.

## Required APIs

- No new customer-facing APIs. Internal: extend whatever `/api/cron/stay-lifecycle` currently does, or add `/api/cron/journey-sends` if it's a distinct concern — verify against the existing route's actual scope first.

## UI Changes

- Settings page: toggle + timing controls for each journey message (reuse the existing `settings` table / `settings-service.ts` pattern — "AI confidence threshold" and "channel toggles" already live there per `CHANGELOG.md`).
- Customer timeline: each journey send should appear as a timeline entry via the existing `activity_logs`/`logActivity()` pattern, so operators see it without a separate journey-log UI.

## AI Opportunities

- Personalize journey message copy per guest (event type, property, repeat-guest status) using `ai-provider.ts` the same way `generateFestivalMessage()` already personalizes festival greetings — same infrastructure, new template.
- AI-flagged "at risk of not returning" scoring feeding the win-back trigger's audience, rather than a fixed 90-day window for everyone — natural extension point for `19_AI_RECOMMENDATIONS.md`.

## Risks

- Directly inherits `04_GAP_ANALYSIS.md` A3 (the unresolved BUG-004 pricing bug) if any journey message's content or trigger condition depends on `final_room_rate` (e.g., a "thank you for your ₹X stay" message) — do not build a message that surfaces that field until the bug is resolved and re-verified.
- Inherits A1 (migration 012 apply status) directly — this entire module is inert until `reservations` is live in production.
- Over-messaging risk: this module must compose with `09_CAMPAIGN_ENGINE.md`'s broadcast sends through the same spam-check (`wasRecentlyContacted()` in `queue.ts`) so a guest doesn't receive a lifecycle message and a festival broadcast within the same rate-limit window.

## Dependencies

- A1, A3 (`04_GAP_ANALYSIS.md`), `05_MARKETING_PLATFORM.md` (shares the send/queue infrastructure), `16_REVIEW_MANAGEMENT.md` (the review-request message's destination).

## Development Priority

**P1, blocked on P0 foundation work** — high business value (this is the single highest-ROI "delight" automation for a repeat-guest hospitality business) but explicitly sequenced after migration 012 lands and BUG-004 is resolved, per the dependency chain above.
