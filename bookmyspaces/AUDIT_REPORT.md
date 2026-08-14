# BookMySpaces CRM — Full-Codebase Audit Report

Scope: bugs, dead code, duplication, security, performance; WhatsApp Cloud API
integration; booking flow, staff dashboard, customer chat, AI assistant, DB
design. Method: 4 parallel research-only audit passes (WhatsApp, booking/DB,
dashboard/chat/AI, dead-code/duplication), each finding independently
re-verified against source before any fix — no finding was implemented on
agent-report trust alone. 7 commits, all local (no push access this session).

## Fixes implemented (high-impact, verified, committed)

### 1. Revenue double-counted `meal_plan_charge` — commit `72bd858`
**Issue**: 7 read sites (`revenue-intelligence.ts`, `campaigns.ts`,
`lifetime-value.ts`, `dashboard/revenue/route.ts`, and 2 spots in
`reservations` pages) computed reservation revenue as
`final_room_rate + meal_plan_charge`.
**Root cause**: `final_room_rate` is the persisted grand total — it already
includes `meal_plan_charge` (see `reservation-workflow.ts`'s
`createReservationWithQuote()`: `finalRoomRate: quote.grandTotal`, where
`grandTotal = subtotal + mealPlanCharge + addonsCharge`). Every revenue
figure derived from these sites was inflated by the meal plan charge.
**Fix**: Removed the extra `+ meal_plan_charge` at all 7 sites; `final_room_rate`
used as-is. Verified by tracing the single INSERT path in
`reservation-service.ts`'s `createReservation()`.

### 2. Lead scoring dual-writer corruption — commit `d5d25fd`
**Issue**: `scoring.ts`'s `batchScoreLeads()` (triggered by
`POST /api/analytics {action:'score_leads'}`) wrote a 1–10 LLM score into
`leads.ai_score`, the same column `auto-qualify.ts`'s live per-message
pipeline writes on a 0–100 scale via `lead-scorer.ts`'s `scoreLead()`.
**Root cause**: Two independent scorers on one column, plus a second drift —
`batchScoreLeads()` filtered on the legacy `ai_scored_at` column (migrations
003/005/006) while the live pipeline sets `scored_at` (migration 008), so it
re-selected already-correctly-scored leads and overwrote their 0–100 score
with a 1–10 value, silently breaking HOT/WARM/COLD temperature and the
escalation-engine's `ai_score>=90` rule.
**Fix**: `batchScoreLeads()` now calls `scoreLead()` for the numeric fields
(correct scale, correct `scored_at` filter/write) and keeps
`scoreLeadWithAI()` only for the qualitative fields it doesn't produce
(`ai_score_reason`, `booking_probability`).

### 3. WhatsApp template send had no retry; `/api/health` monitored the wrong provider — commit `21cfa67`
**Issue A**: `sendWhatsAppTemplate()` made exactly one attempt and gave up,
unlike `sendWhatsAppText()`'s retry-with-backoff. Broadcast campaigns
(`sendBroadcastCampaign` → `sendWhatsAppTemplateSimple` → this) can run
hundreds of recipients; one transient 5xx permanently failed that recipient.
**Fix A**: Added the same `MAX_RETRIES=2` / linear-backoff loop
`sendWhatsAppText()` already uses. New regression test asserts 3 total
attempts and a `failed` status after exhaustion.
**Issue B**: `/api/health`'s `checks.whatsapp` checked `WATI_BASE_URL`/
`WATI_API_TOKEN` — Wati is the legacy, unused provider; actual send/receive
is Meta Cloud API (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`). Ops
monitoring this endpoint had zero signal on the system that's actually live.
**Fix B**: Split into `checks.whatsapp` (Meta creds, same `warn` severity —
overall health-status/HTTP-code behavior unchanged) and a new
`checks.wati_legacy`.

### 4. Missing date-order validation on reservation/manual-block creation — commit `eaed957`
**Issue**: `createReservationSchema` and `createManualBlockSchema` had no
check-in/check-out order validation (only the availability-preview route
checked this, inline, not via the shared schema). A reversed or zero-night
range reached pricing/DB logic instead of failing fast with a clear 400.
**Fix**: Added `.refine()` matching the existing `createRatePlanSchema`
convention to both schemas. 6 new tests (equal dates, reversed dates, for
both schemas).

### 5. Dashboard headline KPIs silently wrong past 500 leads — commit `8e93967`
**Issue**: `HotLeadDashboard.tsx` computed Total Leads / HOT Leads /
Escalated / Pipeline Value / Conversion from the `leads` array returned by
`GET /api/leads/hot`.
**Root cause**: that endpoint orders by `created_at DESC` and hard-caps at
500 rows. `GET /api/dashboard/stats` computes the same aggregates with no
cap and was already being fetched into `summary` — but never read anywhere
in the component.
**Fix**: The 5 business-metric StatCards now prefer `summary`'s unbounded
figures (fallback to the old client-computed value only until that fetch
resolves). Filter-driving counts (`hotCount`, `escCount`, `overdueLeads`,
used by the quick-filter pills and the table) were deliberately left
untouched, so a pill's number always matches what clicking it shows.

### 6. Incomplete price quotes silently persisted as final — commit `383216a`
**Issue**: `calculatePrice()` sets `isComplete: false` when any night in a
requested range has no matching rate plan, with a doc comment saying an
incomplete quote should never be "presented as final" — but
`createReservationWithQuote()` never checked the flag before calling
`createReservation()`, so the under-priced total (unpriced nights counted as
₹0) was silently saved as `final_room_rate`.
**Fix**: Added a new `CreateReservationResult` variant (`'incomplete_quote'`);
`createReservationWithQuote()` now refuses and returns it, with the quote
still attached so the operator can see what's unpriced. The API route
returns 422 with the unpriced-night count instead of creating a
wrong-priced booking. `createManualBlock()` is unaffected (no pricing quote
involved) — `block/route.ts`'s error handling was narrowed to keep that
explicit for the type checker.

### 7. Confirmed-dead code removed — commit `f0f3395`
Independently re-verified zero callers (static imports, dynamic imports, and
string references) before deleting:
- `CRMShell.tsx` — already self-documented `DEPRECATED — NOT MOUNTED`,
  superseded by `CRMLayout.tsx`.
- `transcription.ts` (Whisper voice-note transcription) — no callers.
- `modules/followups/followup-engine.ts` (`getFollowUpCadence`) — no
  callers. **Not** deleted: `followup-rules.ts` in the same directory, which
  *is* live (`process-inbound.ts`, `auto-package-recommendation.ts`,
  `auto-qualify.ts`).
- `supabase-route-handler.ts` and its only consumer, `supabase-types.ts` —
  no callers.
- **Deliberately not deleted**: `providers/email-provider.ts`. It has no
  live caller either, but unlike the above it has its own passing test file
  and 2 sibling provider files (`whatsapp-provider.ts`, `ai-provider.ts`)
  that *are* live — this looks like in-progress framework scaffolding, not
  orphaned code. Listed as a TODO, not deleted.

## Verification (after every fix)
`npx tsc --noEmit` clean · `npx vitest run` 424/424 passing (417 baseline +
7 new) · `next lint` clean (1 pre-existing unrelated warning) · `next build`
succeeds.

## Remaining TODOs (found, not fixed — reasoning below)

These were surfaced by the 4 audit passes but deliberately deferred. Each
either needs a product decision this session can't make blind, needs live
production verification (this session has no DB/Vercel network access —
lesson learned hard this session from migrations 026/027 both shipping on
stale assumptions about production schema), or is a larger architectural
change than "high-impact fix without unnecessary rewrite" covers.

1. **No DB-level double-booking prevention (race condition)** —
   `availability-service.ts`'s `checkAvailability()` is a check-then-insert:
   two concurrent requests for overlapping dates can both pass the
   availability check and both insert. The fix is a Postgres `EXCLUDE`
   constraint (`btree_gist` + `daterange(check_in_date, check_out_date)` +
   `inventory_item_id`, scoped to blocking statuses) — the correct,
   standard way to make this atomic. **Not shipped**: an `EXCLUDE`
   constraint's `ADD CONSTRAINT` validates every existing row and cannot be
   added `NOT VALID` (unlike CHECK/FK constraints) — if any overlapping
   active reservations already exist in production (plausible, given this
   is the exact bug being fixed), the migration fails outright on apply,
   and this session cannot query production to check first. Recommend:
   run a duplicate/overlap audit query against production, resolve any
   conflicts manually, then apply the constraint as its own migration.

2. **WhatsApp inbound media handling gap** — flagged by the WhatsApp audit
   pass as incomplete for non-text inbound message types. Needs a decision
   on which media types (image/audio/document) the CRM should actually
   process vs. just log, before writing storage/processing code.

3. **WhatsApp inbound idempotency gap** — no confirmed dedup on inbound
   webhook delivery; Meta can redeliver the same message. Needs the
   dedup key strategy decided (message ID vs. a composite key) against how
   `whatsapp_messages`/`unified_messages` are actually keyed in production.

4. **Dead `process-inbound.ts` pipeline** — appears superseded by a newer
   inbound path but still present and importing live code
   (`followup-rules.ts`). Product decision needed on whether it's truly
   retired before deleting (unlike this session's other dead-code
   deletions, deleting this would also touch a still-live shared module's
   apparent caller count).

5. **Kanban board's Activity Timeline panel** — flagged as rendering but
   effectively dead (no data reaches it). Needs a decision: wire it up or
   remove it; not a pure deletion.

6. **Inbox race condition** — flagged by the dashboard/chat audit pass
   around concurrent reply handling; needs reproduction against real
   concurrent-user behavior before a fix can be verified, which this
   session's sandbox can't do.

7. **`providers/email-provider.ts`** — unused adapter with its own test
   file; see item 7 above. Low risk either way; left as-is rather than
   guessed at.

8. **`ai-summary.ts`'s `gatherDailyMetrics()`** — does `.gte('ai_score', 7)`,
   assuming the old 1–10 scale (see fix #2 above). Currently moot:
   `/api/ai-summary` is a dead stub that never calls this function. If that
   route is ever wired up, this threshold needs updating to the 0–100 scale
   first.

9. **`route.ts`'s stale `db_error` comment** — `POST /api/reservations`'s
   error handler has a comment claiming `db_error` "almost always means
   migration 012's `reservations` table isn't applied yet." The booking-flow
   audit pass flagged this as outdated — reservation/invoice/meal-plan
   wiring is fully built and live elsewhere in the repo, contradicting the
   comment's premise. Left as-is (comment only, no behavior change) but
   should not be trusted as current truth by a future reader.
