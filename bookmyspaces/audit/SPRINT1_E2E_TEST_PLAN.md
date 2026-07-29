# Sprint 1 (Availability & Escalation) — End-to-End Test Plan

Written: 2026-07-29. Cannot be executed from this sandbox — no network egress to Supabase (re-confirmed this session), migration 012/13 not yet applied to production (confirmed this session, see `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md`), and no live deployment exists. This is the checklist for Raju (or CI, once one exists) to run once real access is available — same handoff pattern as that document's own "Manual app-level verification" section, extended with what Sprint 1 actually added.

## Prerequisite

Migration 012/13 applied and smoke-tested (`npm run db:migrate:v3` then `npm run db:smoke-test:v3`) — nothing below is testable against a database that doesn't have `reservations`/`inventory_items` yet.

## 1. Manual availability override (`POST /api/reservations/block`)

1. As a logged-in staff user, call `POST /api/reservations/block` with a real `propertyId`/`inventoryItemId` and a near-future date range, e.g. `reason: "Maintenance test"`.
2. Confirm it returns `201` with a `reservation` whose `guestName` starts with `BLOCKED —`.
3. Confirm that reservation appears in the existing Reservation Dashboard (`/reservations`) — it should look like a normal row (no dashboard changes were made; this proves nothing broke).
4. Call `GET /api/reservations/availability` (or attempt `POST /api/reservations` with an overlapping date range for the same `inventoryItemId`) and confirm it now reports **unavailable**, listing the block's own reservation id as the conflict. This is the actual product guarantee this feature exists for — it must be exercised against real Postgres, not just mocked Supabase, since it depends on the real overlap query/index (`idx_reservations_dates`).
5. Repeat step 1 with a `reason` left blank — confirm the API rejects it with a 400 (`createManualBlockSchema` requires a non-empty reason).
6. Repeat step 1 with dates that are already blocked/booked — confirm a 409 with `conflictingReservationIds` populated, not a silent double-book.

## 2. Unknown-availability escalation (WhatsApp, orchestration-enabled only)

This path only fires when `settings.orchestration.enabled = true` (default false) — confirm that setting is on before testing, and confirm what happens with it off (nothing from Sprint 1 should change WhatsApp's default behavior; this is the pre-existing scope boundary, not new to this sprint).

1. With orchestration enabled, send a WhatsApp message that resolves to a `check_room_availability`/`check_banquet_availability` decision (a message with a clear inventory item and date already in slot memory).
2. The hard part: forcing a genuine DB-query failure on demand isn't really controllable through the UI. Two practical options:
   - Ask a developer to temporarily point `NEXT_PUBLIC_SUPABASE_URL`/the service key at an invalid value in a **non-production** environment for this one test, send the message, then revert.
   - Or treat this as covered by the automated integration test (`src/lib/ai/availability-escalation.integration.test.ts`) instead, and only manually verify the **normal** (non-error) path live: a real available/unavailable check still returns correctly and does NOT trigger the interim policy.
3. If a failure can be forced: confirm the customer receives the polite holding reply ("Thank you for your enquiry. We're checking availability with our team...") and that the conversation shows as escalated (`unified_conversations.status = 'escalated'`, `ai_active = false`) with `ai_interaction_log.escalation_reason = 'availability_unknown'`.
4. Confirm a normal (non-error) unavailable check does NOT trigger the interim policy — it should behave exactly as it did before this sprint (no reply, no escalation — a separate, pre-existing, deliberately-unresolved gap this sprint didn't touch, see `orchestration-executor.ts`'s own file header on the `kind: 'unavailable'` case for the "no inventory id" scenario specifically, which is different from the DB-error scenario this sprint fixed).

## 3. Regression check

Confirm every existing reservation flow (New Reservation modal, confirm/cancel/check-in/check-out) still works exactly as before — nothing in Sprint 1 changed `createReservation()`, `createReservationWithQuote()`, or the reservation status state machine; `createManualBlock()` and the `status` field addition to `AvailabilityCheckResult` are additive only.

## What's already verified (scoped, mocked, this session)

Unit tests: `availability-service.test.ts` (8), `orchestration-executor.test.ts` (14), `orchestrator.test.ts` (7), `action-arguments.test.ts` (25), `orchestration-engine.test.ts` (18), `tool-registry.test.ts` (9), `reservation-workflow.test.ts` (21), `validation.test.ts` (19) — all passing at time of writing. Integration test `availability-escalation.integration.test.ts` (real tool-registry + real availability-service, only `@/lib/supabase` mocked) is written and manually reviewed for correctness, but this session's sandbox degraded mid-verification (even previously-passing files began timing out) and a clean run could not be captured before this document was written — re-run it first, before anything else in this checklist.
