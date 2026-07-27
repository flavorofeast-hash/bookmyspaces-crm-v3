# Reservation & Booking Management — Architecture Audit

**Type:** Read-only architecture review. No code, migrations, or data were modified to produce this report.
**Method:** Every claim below is sourced directly from repository files (exact paths cited) or from existing `audit/*.md` documents, cross-checked against the actual code rather than trusted at face value where checkable. Nothing here is inferred from naming conventions alone.

---

## 1. Executive Summary

The Reservation & Booking Management module is **substantially built, well-designed, and completely unproven against a live database.** This is the central fact governing every finding below.

A full-stack Reservation Platform already exists in this repository: a 16-table schema (migration 012, plus a 5-column extension in migration 013), a clean service layer (property/availability/reservation/pricing services + an orchestration layer), 8 authenticated API routes with genuinely good REST discipline (409 for conflicts, 502 for "dependency not ready" vs 500 for real errors), 4 UI screens (Dashboard, Details, Calendar, Catalog admin), a domain-modeled state machine for booking status, and 40 unit/mock tests across 5 test files.

None of it has ever run against Postgres. Migration 012 is explicitly marked "NOT YET APPLIED" in its own file header, corroborated by a dedicated, still-outstanding deployment guide (`audit/MIGRATION_012_013_DEPLOYMENT_VALIDATION.md`) and by defensive "not yet applied" comments in every single service, API route, and UI file that touches these tables. This is not a guess — three independent sources agree, and every sandbox session on this project (this one included) has had no network path to the live Supabase project to check further.

Two features that look complete in the schema are, on inspection, not wired into the actual booking flow at all: **Meal Plans** and **Add-on Services** have full admin CRUD (catalog page + service) but zero code path that lets an operator attach one to a reservation or have it affect the price. Payment tracking and invoicing are live and working today — but only through the older Proposals flow, not connected to the new Reservation Platform (`reservations.invoice_id` exists as a column and is never populated by any code). A pre-existing, unrelated `bookings` table (migration 003, banquet/event-oriented) is not part of this system at all and should not be confused with "Booking Management" in the target feature list.

**Bottom line recommendation:** do not build a second reservation system. Apply migration 012/013 using the tooling that already exists (`npm run db:migrate:v3`, already-built smoke test `npm run db:smoke-test:v3`), run the manual verification checklist that's already written (`MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` §4), fix what the smoke test and live testing actually surface, then close the two real gaps (meal plan/add-on booking-flow integration, reservation→invoice linkage). This is finishing work, not new architecture.

---

## 2. Existing Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI (src/app/(crm)/…)                                                │
│  reservations/page.tsx (Dashboard)  reservations/[id]/page.tsx        │
│  reservations/calendar/page.tsx     catalog/page.tsx (admin CRUD)     │
└───────────────┬────────────────────────────────┬──────────────────┘
                │ fetch()                         │ fetch()
┌───────────────▼────────────────────────────────▼──────────────────┐
│  API (src/app/api/…)  — all requireAuth()-gated, zod-validated       │
│  reservations/route.ts (GET list, POST create)                       │
│  reservations/[id]/route.ts (GET one)                                 │
│  reservations/[id]/status/route.ts (POST confirm/cancel/in/out)       │
│  reservations/[id]/proposal/route.ts (POST → generates a proposal)    │
│  reservations/availability/route.ts (POST check + quote)              │
│  properties/route.ts (GET properties + inventory items)               │
│  admin/catalog/[entity]/route.ts, [entity]/[id]/route.ts (5 entities) │
└───────────────┬───────────────────────────────────────────────────┘
                │ calls
┌───────────────▼───────────────────────────────────────────────────┐
│  Service layer (src/lib/reservations/, src/lib/pricing/,             │
│  src/lib/admin/catalog-service.ts)                                    │
│  property-service · availability-service · reservation-service        │
│  reservation-workflow (orchestrates the above + pricing-service)      │
│  pricing-service (rate_plans engine + LIVE packages-table pricing)    │
│  catalog-service (generic CRUD for 5 catalog tables)                  │
│  → all use getSupabaseAdmin() (service-role), never a session client  │
└───────────────┬───────────────────────────────────────────────────┘
                │ reads/writes
┌───────────────▼───────────────────────────────────────────────────┐
│  Database (supabase/migrations/012_v3_foundation_schema.sql,          │
│  013_proposal_reservation_links.sql) — NOT YET APPLIED                │
│  properties, inventory_items, meal_plans, rate_plans, addon_services, │
│  reservations, reservation_addons, + 8 more unrelated V3 tables       │
│  ── links into the LIVE schema ──                                     │
│  reservations.proposal_id → proposals(id)          [LIVE table]       │
│  reservations.invoice_id  → invoices(id)            [LIVE, unused FK] │
│  proposals.reservation_id/property_id/… (013)      [LIVE table,       │
│                                                       new columns]     │
└─────────────────────────────────────────────────────────────────────┘

Side systems that already work independently and are NOT part of this
module: `bookings` table (migration 003, banquet events — separate,
pre-existing, unrelated), `invoices`/`payments` (migration 009, LIVE,
scoped to `proposals` only, not `reservations`).
```

---

## 3. Reservation Module Inventory

| Layer | File | Status |
|---|---|---|
| Types/domain | `src/types/reservation.ts` | Complete — Property, InventoryItem, MealPlan, RatePlan (+ `resolveApplicableRate`), AddonService, ReservationAddon, Reservation, `VALID_RESERVATION_TRANSITIONS` state machine |
| Service | `src/lib/reservations/property-service.ts` | Complete |
| Service | `src/lib/reservations/availability-service.ts` | Complete |
| Service | `src/lib/reservations/reservation-service.ts` | Complete |
| Service | `src/lib/reservations/reservation-workflow.ts` | Complete (orchestration) |
| Service | `src/lib/pricing/pricing-service.ts` | Complete, dual-mode (live `packages` path + not-yet-live `rate_plans` path) |
| Service | `src/lib/admin/catalog-service.ts` | Complete |
| API | `src/app/api/reservations/route.ts` | Complete |
| API | `src/app/api/reservations/[id]/route.ts` | Complete |
| API | `src/app/api/reservations/[id]/status/route.ts` | Complete |
| API | `src/app/api/reservations/[id]/proposal/route.ts` | Complete |
| API | `src/app/api/reservations/availability/route.ts` | Complete |
| API | `src/app/api/properties/route.ts` | Complete |
| API | `src/app/api/admin/catalog/[entity]/route.ts`, `[entity]/[id]/route.ts` | Complete |
| UI | `src/app/(crm)/reservations/page.tsx` | Complete (Dashboard + New Reservation modal) |
| UI | `src/app/(crm)/reservations/[id]/page.tsx` | Complete (Details + status actions + proposal generation) |
| UI | `src/app/(crm)/reservations/calendar/page.tsx` | Complete (14-day grid) |
| UI | `src/app/(crm)/catalog/page.tsx` | Complete (5-entity admin CRUD) |
| Migration | `supabase/migrations/012_v3_foundation_schema.sql` | Written, reviewed, **not applied** |
| Migration | `supabase/migrations/013_proposal_reservation_links.sql` | Written, reviewed, **not applied** (depends on 012) |
| Migration rollback | `..._012_..._ROLLBACK.sql`, `..._013_..._ROLLBACK.sql` | Written |
| Deployment tooling | `scripts/apply-v3-migrations.mjs` (`npm run db:migrate:v3`) | Written |
| Deployment tooling | `scripts/smoke-test-v3.mjs` (`npm run db:smoke-test:v3`) | Written — 7-point structural + functional check, see §4 |
| Deployment tooling | `npm run db:rollback:v3` | Written |
| Tests | 5 files under `src/lib/reservations/*.test.ts` | 40 `it`/`test` cases, all mock-based |
| Docs | `audit/MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` | Current, actionable, authoritative deployment checklist |
| Docs | `audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md` | Original design source migration 012 is built against |
| Docs | `audit/DAY1_EXECUTION_REPORT.md` … `DAY5_EXECUTION_REPORT.md` | Exist |
| Docs gap | `audit/DAY6_EXECUTION_REPORT.md` | **Cited by 5+ code comments** (`reservations/route.ts`, `reservations/page.tsx`, `calendar/page.tsx`, `properties/route.ts`) **but does not exist in the repo.** Either never written or lost — a real documentation gap, not something to assume is fine. |

---

## 4. Database Inventory

### 4.1 Already LIVE (pre-dates this module, unrelated migrations, presumed applied per prior sessions' verification — not re-verified against production in this pass)

| Table | Migration | Purpose | Relation to Reservation Platform |
|---|---|---|---|
| `proposals` | 003 | Flat proposal record: single `event_date`, free-text `venue`/`package_name` | Extended by migration 013 (not live) to link to the new schema |
| `bookings` | 003 | Legacy banquet/event booking: single `event_date`, `venue TEXT`, own status enum (`tentative/confirmed/completed/cancelled`) | **Not used by any Reservation Platform code.** Zero references from `reservation-service.ts`, `reservation-workflow.ts`, or any reservation API route. Confirmed by grep — the two systems don't touch. |
| `packages` | 007 | Silver/Gold/Platinum tiers, `base_price` | Read live by `pricing-service.ts`'s `getActivePackagePrices()` — this is the one part of the pricing engine already working today |
| `invoices` | 009 | `proposal_id` FK, auto-numbered, subtotal/tax/total/advance/balance | `reservations.invoice_id` column (012) references this table's `id`, but **no code anywhere sets it** |
| `payments` | 009 | `proposal_id` FK, auto-numbered, triggers proposal payment-status sync | Same as above — scoped to proposals, not reachable from a reservation |

### 4.2 Drafted, reviewed, **NOT applied** — migration 012 (`supabase/migrations/012_v3_foundation_schema.sql`)

16 tables, all `CREATE TABLE IF NOT EXISTS` (idempotent), all `ENABLE ROW LEVEL SECURITY` with a single `service_role`-only `FOR ALL` policy (consistent across every table — no partial-RLS gap found here, unlike issues found elsewhere in this codebase in earlier sessions):

`properties`, `customer_identities`, `channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages`, `inventory_items`, `meal_plans`, `rate_plans`, `addon_services`, `reservations`, `reservation_addons`, `settings`, `ai_prompts`, `knowledge_sources`, `ai_interaction_log`.

Reservation-relevant highlights:
- `properties` — `slug UNIQUE`, seeded with 2 rows (Skyline Serenity, Monurama Homestay) via `ON CONFLICT (slug) DO NOTHING`.
- `inventory_items` — generalized from a hotel-room-only design to 10 types (room/suite/apartment/banquet_hall/conference_hall/rooftop/restaurant_event_area/wedding_venue/birthday_venue/meeting_room), per an explicit master-spec requirement documented in the migration's own header.
- `rate_plans` — `CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)`, `priority INTEGER`.
- `reservations` — `nights INTEGER GENERATED ALWAYS AS (check_out_date - check_in_date) STORED`, `CHECK (check_out_date > check_in_date)`, FKs to `properties`, `inventory_items`, `leads` (customer_id), `proposals` (proposal_id, one-directional), `invoices` (invoice_id, unused), `meal_plans` (meal_plan_id).
- `reservation_addons` — junction table (reservation_id, addon_service_id, quantity, unit_price, total_price). **Zero application code references this table** (confirmed by repo-wide grep) — schema-only.
- Indexes: `idx_reservations_dates` (check_in_date, check_out_date) is the one `availability-service.ts`'s overlap query depends on for performance; also `idx_reservations_status`, `idx_reservations_property_id`, `idx_reservations_inventory_item_id`, `idx_reservations_customer_id`.
- `idx_knowledge_sources_embedding` — HNSW vector index, unrelated to reservations but part of the same migration.

### 4.3 Drafted, reviewed, **NOT applied** — migration 013 (`supabase/migrations/013_proposal_reservation_links.sql`)

Additive, nullable columns on the **live** `proposals` table: `property_id`, `inventory_item_id`, `reservation_id`, `package_id`, `addon_service_ids UUID[]`. Depends on 012 (references `properties`, `inventory_items`, `reservations`). Explicitly does not touch or deprecate the existing `venue`/`package_name` free-text columns — old proposals keep their historical snapshot.

### 4.4 Evidence that 012/013 are still unapplied (three independent sources, not one assumption)

1. Migration 012's own file header: "NOT YET APPLIED to the live database."
2. `audit/MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` — a dedicated, current checklist stating the same, with exact commands to close the gap.
3. Defensive comments in **every** file that reads these tables (`property-service.ts`, `reservation-service.ts`, `availability-service.ts`, `reservation-workflow.ts`, all 6 reservation API routes, all 4 UI pages) independently stating the same thing and coding an honest degraded state (empty list, not a 500) for when the tables don't exist.

No sandbox session on this project has ever had network egress to the live Supabase project (`nssteddtqgqubggpcwae.supabase.co` — confirmed unreachable, not assumed, per `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` itself). This audit could not independently re-verify current production state either, for the same reason. **If production state has changed since these documents were written, only a live query against Supabase can confirm it — treat "not applied" as highly likely, not certain, until verified live.**

### 4.5 Deployment tooling already built (not something to design from scratch)

- `npm run db:migrate:v3` → `scripts/apply-v3-migrations.mjs` — applies 012 then 013 in order, idempotent.
- `npm run db:smoke-test:v3` → `scripts/smoke-test-v3.mjs` — checks: all 16 tables exist; all 5 migration-013 columns exist; the 4 FKs the app actually depends on are enforced; the specific indexes the app's queries rely on exist; RLS is enabled with a service-role policy on every new table; both seed properties are present; and a **functional test** — inserts a throwaway inventory item/rate plan/reservation inside a transaction that is always rolled back, and confirms `availability-service.ts`'s real overlap query correctly flags a genuine conflict and correctly clears a genuinely free range, plus confirms the generated `nights` column computes correctly.
- `npm run db:rollback:v3` — reverse order, with an explicit data-loss warning baked into the script's own printed output.

---

## 5. API Inventory

| Route | Method | Auth | Validation | Notes |
|---|---|---|---|---|
| `/api/reservations` | GET | `requireAuth()` | — | List, filterable by status (CSV)/date ranges/property |
| `/api/reservations` | POST | `requireAuth()` | `createReservationSchema` (zod) | Availability→price→create in one call; 409 on conflict, 502 if the DB dependency isn't ready |
| `/api/reservations/[id]` | GET | `requireAuth()` | — | Single, joined with property/inventory name |
| `/api/reservations/[id]/status` | POST | `requireAuth()` | `reservationStatusActionSchema` (zod) | `confirm`/`cancel`/`check_in`/`check_out` only — see gap in §8 |
| `/api/reservations/[id]/proposal` | POST | `requireAuth()` | — | Generates a proposal from a reservation; depends on migration 013 |
| `/api/reservations/availability` | POST | `requireAuth()` | `checkAvailabilitySchema` (zod) | Quote without creating, for the live "New Reservation" form |
| `/api/properties` | GET | `requireAuth()` | — | Properties + inventory items, feeds 3 different UI screens |
| `/api/admin/catalog/[entity]` | GET, POST | `requireAuth()` | `catalogCreateSchemas[entity]` (zod, `.strict()`) | 5 entities: properties, inventory-items, meal-plans, rate-plans, addon-services |
| `/api/admin/catalog/[entity]/[id]` | PATCH, DELETE | `requireAuth()` | `catalogUpdateSchemas[entity]` (zod) | DELETE is a soft-delete (`is_active = false`) |

Error-handling discipline is genuinely good throughout: 409 is used for business-rule conflicts (date overlap, invalid status transition), 502 specifically signals "this route's dependency isn't ready" (i.e., migration not applied) rather than being conflated with a generic 500, and 404/400 are used correctly elsewhere. This is a deliberate, consistent pattern, not incidental.

**Gap:** none of these 8 routes currently enforce a role check beyond `requireAuth()` (any authenticated user, not just admin/manager) — matching the rest of this app's general pattern per earlier session findings, not a defect specific to this module.

---

## 6. UI Inventory

| Page | Route | What it does | Depends on |
|---|---|---|---|
| Reservation Dashboard | `/reservations` | Stat cards (arrivals/departures/pending/confirmations/checked-in/active revenue, all computed client-side from one list fetch), upcoming-reservations table, New Reservation modal (availability check → quote → create), and a "Convert Proposal → Reservation" prefill path via `?fromProposalId=` | migration 012 |
| Reservation Details | `/reservations/[id]` | Full record, pricing breakdown, 4 status-action buttons (context-sensitive per current status), "Generate proposal from this reservation" button, link out to the linked customer's profile, invoice status (read-only) | migration 012 (+013 for the proposal-generation button) |
| Reservation Calendar | `/reservations/calendar` | 14-day grid, inventory items grouped by type, multi-property filter, color-coded by status, click-through to Details | migration 012 |
| Catalog admin | `/catalog` | 5-tab CRUD (Properties / Rooms & Venues / Rate Plans / Meal Plans / Add-ons), one shared field-config-driven form, soft-delete only | migration 012 |

All four pages already implement an honest empty/degraded state ("migration 012 not applied yet" messaging, zero stats, empty pickers) rather than a hard error — this is a deliberate, already-established convention in this codebase, not a bug to fix.

No dedicated Reports/Revenue/Occupancy page exists (see §8, §13).

---

## 7. Service Layer Inventory

| Service | Key functions | Notes |
|---|---|---|
| `property-service.ts` | `listActiveProperties`, `getPropertyBySlug`, `listActiveInventoryItems` | Simple reads, all via `getSupabaseAdmin()` |
| `availability-service.ts` | `checkAvailability`, `dateRangesOverlap` (pure, unit-tested) | Overlap logic pushed into the SQL query (`idx_reservations_dates`) with an app-layer re-check as defense in depth; "available" is currently a binary yes/no per inventory item — see §8 for the room-count limitation |
| `reservation-service.ts` | `createReservation`, `transitionReservationStatus`, `listReservations`, `getReservationById` | Status transitions delegate to `isValidReservationTransition()` — no route or service bypasses the state machine |
| `reservation-workflow.ts` | `calculatePrice`, `createReservationWithQuote`, `confirmReservation`, `cancelReservation`, `checkInReservation`, `checkOutReservation` | Every state-changing call writes an `activity_logs` row (fire-and-forget — a logging failure never fails the underlying operation); explicitly reuses the same `activity_logs` table `/api/leads` already writes to, not a parallel log |
| `pricing-service.ts` | `getActivePackagePrices` (LIVE), `getInventoryItemRate` (not live), `checkSystemPromptPricingDrift` (monitoring only) | Deliberately dual-mode — old `packages`-based pricing keeps working today independent of the new `rate_plans` engine |
| `catalog-service.ts` | `listCatalogRows`, `createCatalogRow`, `updateCatalogRow`, `deactivateCatalogRow` | Column allow-lists per entity (mass-assignment protection, same pattern as `validation.ts`'s lead schemas); deletes are soft only, by design (catalog rows are FK-referenced by rate plans/reservations) |
| `proposal-service.ts` (`createProposalFromReservation`) | Bridges Reservation → Proposal | Writes migration-013 columns (`property_id`, `inventory_item_id`, `reservation_id`, `package_id`, `addon_service_ids`) — depends on 013 |

---

## 8. Gap Analysis

Real gaps, distinct from "just needs the migration applied":

1. **Meal Plans are not integrated into the booking flow.** `meal_plans` table + full catalog CRUD exist. `reservations.meal_plan_id`/`meal_plan_charge` are readable (displayed on the Details page) and typed, but `createReservation()`'s insert (`reservation-service.ts` lines 60–76) never sets them, and the New Reservation modal (`reservations/page.tsx`) has no meal-plan selector at all. Every reservation is created with these fields at their DB default. This is a genuine missing feature, not a migration-blocked one.

2. **Add-on Services have even less integration.** `addon_services` + `reservation_addons` (junction table) exist in the schema. Repo-wide grep for `reservation_addons` returns **zero** application-code matches — nothing ever inserts into it. No add-on picker exists in any booking UI, and `calculatePrice()` never includes addon cost.

3. **Payment/Invoice tracking is disconnected from Reservations.** `invoices`/`payments` are live today (migration 009) but scoped to `proposals`. `reservations.invoice_id` exists and is never populated by any code path. The only route from a reservation to an invoice is manual: Reservation → "Generate proposal" → Proposals page → generate invoice there. There is no one-click "invoice this reservation" action.

4. **Room Allocation is not implemented, and this is documented as deliberate.** `availability-service.ts`'s own header states `room_count` is "not factored in here deliberately" — availability today means "zero overlapping reservations for this exact inventory_item row," not "are there N free units of this room type." If a property ever has more than one physical unit represented by a single `inventory_items` row, this model cannot currently express that correctly.

5. **Status-transition UI coverage is incomplete.** The state machine (`VALID_RESERVATION_TRANSITIONS`) allows `inquiry → tentative`, but no named workflow wrapper or UI button exists for it (`AVAILABLE_ACTIONS` in `reservations/[id]/page.tsx` only offers confirm/cancel/check_in/check_out) — explicitly noted in that file's own comment as intentional-for-now, not accidental, but still a real usability gap.

6. **No Taxes.** `invoices.tax_amount` exists as a column but nothing computes it — always defaults to 0. No tax concept exists on `reservations` at all.

7. **No Reports/Revenue/Occupancy screens.** The Dashboard's "Active Revenue" stat is a client-side sum over whatever's currently loaded — not a real report, not exportable, not broken down by period/property/source. No occupancy-rate calculation exists anywhere, including on the Calendar (which visualizes booked/free cells but computes no aggregate).

8. **`audit/DAY6_EXECUTION_REPORT.md` is cited but missing.** Five-plus code comments reference this file for further context; it does not exist in `audit/`. Either it was never written or was lost — worth confirming with whoever ran that session, since it may contain decisions not otherwise captured.

9. **Zero live-database validation, ever.** Every test is a mock. No sandbox session on this project has had network access to Supabase. This is the single largest source of residual risk across the entire module — the code is well-reasoned but has literally never touched a real Postgres instance.

---

## 9. Technical Debt

- `reservation_addons` and the add-on half of `meal_plans` are schema debt-in-waiting: shipping migration 012 as-is creates two tables that are immediately dead weight until the booking-flow integration (§8, items 1–2) is built. Not harmful, but worth deciding whether to build the integration in the same pass as applying the migration, so the tables don't sit unused indefinitely.
- `reservations.invoice_id` is an FK to a concept (`invoices`) that only gets created through a completely different flow (Proposals). Either wire it up or document it as aspirational/future.
- Two different "booking" vocabularies exist in the same codebase: the legacy `bookings` table (migration 003, banquet events) and the new `reservations` table (migration 012, room/hall stays). They are unrelated in code but easy to confuse by name — worth a naming/documentation clarification before this grows further, per the user's explicit ask to flag duplicated functionality.
- `packages` (live, Silver/Gold/Platinum) and `rate_plans` (not live, per-inventory-item/date) are two independent pricing systems. `pricing-service.ts`'s `checkSystemPromptPricingDrift()` exists specifically because the AI chat's hardcoded prompt pricing can silently drift from the live `packages` table — this is an existing, acknowledged risk, not new.

---

## 10. Production Risks

- **Untested at scale / under concurrency.** The availability check is correct in isolation (unit-tested), but no session has verified it holds up under concurrent booking attempts for the same inventory item on overlapping dates — the code checks availability, then inserts, with no explicit transaction/locking between the two steps visible in `reservation-service.ts`'s `createReservation()`. A race is theoretically possible (two near-simultaneous requests both pass the check before either inserts). Worth a dedicated concurrency test before this handles real booking volume.
- **The Calendar computes coverage client-side** over up to 200 reservations × 14 days × however many inventory items exist — fine at current scale, but has no tested upper bound.
- **RLS is uniformly service-role-only** across every migration-012 table, meaning the entire reservation system's authorization currently depends entirely on `requireAuth()` at the API layer, not on database-level policy. Consistent and deliberate, but means a bug in `requireAuth()` or a route that forgets to call it would have no RLS backstop for this module specifically (this is a repo-wide pattern, not unique to reservations, per earlier session findings on other modules).
- **No tested rollback-under-real-data scenario.** The rollback script exists and has a warning, but has never been exercised against a database that actually has reservations in it.

---

## 11. Migration Risks

- 012 and 013 are additive-only (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), idempotent, and self-reviewed — low structural risk.
- The one already-caught-and-fixed risk: `ai_interaction_log`'s original column list didn't match what `timeline-service.ts` had already been querying since an earlier session (missing `lead_id`, `interaction_type`, `summary`). This was found and fixed **before** application, documented in `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` itself, with an explicit `ALTER TABLE` fallback given in case an older copy of 012 was ever applied elsewhere first. Worth checking that fallback isn't needed before running `db:migrate:v3` fresh.
- 013 depends on 012 (references `properties`, `inventory_items`, `reservations`) — must be applied in order; `apply-v3-migrations.mjs` already enforces this order.
- No migration risk was found that isn't already documented in the existing deployment guide — this audit did not surface anything beyond what `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` already says.

**Recommendation on 012/013 specifically: apply them.** They are reviewed, additive, idempotent, have a working smoke test with a real functional (not just structural) check, and have a working rollback path. There is no basis in this audit for recommending they be merged, superseded, or discarded — the evidence points to "ready to apply, blocked only by needing someone with real Supabase access to run it."

---

## 12. Reuse Opportunities

- **Everything in §3 should be reused as-is.** There is no basis for rewriting any part of this module — the design is coherent, the state machine mirrors an already-proven pattern (`src/modules/leads/lead-stage-manager.ts`), and the code quality (validation, error handling, activity logging, RLS) matches or exceeds other recently-audited parts of this codebase.
- `activity_logs` (already live, already used by `/api/leads`) is correctly reused by `reservation-workflow.ts` rather than a parallel log table — good precedent to keep following for future reservation features.
- `timeline-service.ts` already generically reads `reservations` — no additional work needed for reservations to appear in a customer's timeline once the migration is live (§4.4 caveat aside).
- The Catalog page's field-config-driven form pattern (`ENTITY_CONFIG` in `catalog/page.tsx`) is a genuinely reusable pattern — if a Meal Plan/Add-on picker is added to the booking flow (closing gap #1/#2), it doesn't need a new form-building approach, just a smaller, purpose-built selector reading from the same catalog data already exposed by `/api/admin/catalog/meal-plans` and `/api/admin/catalog/addon-services`.

---

## 13. Recommended Architecture

No architectural changes are recommended. The existing design (Property → Inventory Item → Rate Plan / Reservation, with Meal Plan and Add-on Service as attachable line items) already matches the master specification's stated requirements (multi-property, not hotel-room-only, configurable pricing). The two additive pieces needed are:

1. A **meal-plan and add-on selection step** in the New Reservation modal, feeding through to `calculatePrice()`/`createReservation()` so `meal_plan_id`/`meal_plan_charge` and `reservation_addons` rows are actually populated — additive to the existing workflow functions, not a redesign of them.
2. A **"Generate invoice" action directly from a Reservation** (or from a reservation-generated proposal, populating `reservations.invoice_id` once the invoice exists) — closes the FK that already exists but is never written.

Neither requires new tables or a new service layer — both slot into the existing `reservation-workflow.ts` orchestration pattern.

---

## 14. Recommended Development Order

1. Apply migration 012 then 013 (`npm run db:migrate:v3`), using a real Supabase connection string, per `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` §1–2.
2. Run `npm run db:smoke-test:v3` — fix whatever it actually reports, not hypothetical issues.
3. Manual app-level verification exactly as already scripted in `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` §4 (Dashboard loads clean, Customers page unaffected, add real inventory/rate data, run one full reservation → proposal → invoice loop).
4. Add at least one concurrency test for `checkAvailability` → `createReservation` (see §10) before relying on this for real overlapping-demand bookings.
5. Close gap #1 (meal plans in the booking flow) — smallest of the two integration gaps, most directly requested by the target feature list.
6. Close gap #2 (add-on services in the booking flow).
7. Close gap #3 (reservation → invoice linkage) — either a direct "Generate Invoice" action on the Reservation Details page, or at minimum populate `invoice_id` when one is created via the existing Proposals-page path.
8. Add the missing `inquiry → tentative` action to the Details page's `AVAILABLE_ACTIONS` (trivial — the state machine already allows it).
9. Only after the above: consider Reports/Revenue/Occupancy and Taxes — currently missing entirely and lowest-priority relative to finishing what's already 80% built.
10. Locate or reconstruct `audit/DAY6_EXECUTION_REPORT.md`, or confirm with the user it never existed, so the citations in the code aren't pointing at nothing.

---

## 15. Estimated Effort

Rough, repository-driven estimates — based on the amount of already-working code each item builds on, not a blind guess:

| Item | Estimate | Basis |
|---|---|---|
| Apply migrations + smoke test + manual verification (§14 steps 1–3) | 1–2 hours of hands-on time (mostly waiting on someone with Supabase access) | Tooling already built and tested against mocks; this is execution, not development |
| Concurrency test for availability/create | 0.5–1 day | New test + possibly a transaction/advisory-lock fix if the race proves real |
| Meal plan booking-flow integration | 0.5–1 day | Schema, service field, and display already exist; only the selector UI + wiring into `calculatePrice`/`createReservation` is new |
| Add-on service booking-flow integration | 1–1.5 days | Same as above, plus a real junction-table write path (`reservation_addons`) that doesn't exist yet at all |
| Reservation → Invoice linkage | 0.5–1 day | `invoices` system already fully live; this is wiring, not new invoice logic |
| Missing `tentative` action | <1 hour | State machine already allows it; just needs a UI entry + no new wrapper function required (an existing generic `transitionReservationStatus` call would work, or a one-line named wrapper matching the existing pattern) |
| Taxes | 1–2 days | Genuinely new: rate/rule definition, computation, display, `invoices.tax_amount` wiring |
| Reports / Revenue / Occupancy | 3–5 days | Genuinely new: no existing aggregation layer, would need new queries and at least one new page |

**Total to close every gap in this report: roughly 1.5–2.5 weeks of focused work**, the large majority of which (migration application, meal plans, add-ons, invoice link, tentative action) is finishing an already-designed system rather than new architecture.

---

## 16. Final Recommendation

**Reuse, don't rebuild.** The Reservation & Booking Management system already exists, is well-designed, and is close to production-ready — its single biggest blocker is that migration 012/013 has never been applied, which also means none of it has ever been exercised against a real database. That is the first and most important thing to fix, and the tooling to do it safely (migrate, smoke-test, rollback) is already built and just needs to be run by someone with real Supabase access.

After that: two real feature gaps exist (meal plans and add-on services aren't wired into the actual booking flow despite having full admin CRUD), one real integration gap exists (reservations can't generate an invoice directly), and a handful of genuinely-not-started features exist (taxes, reports, occupancy, room allocation across multiple identical units) that were correctly scoped as follow-on work, not overlooked.

Nothing in this audit found duplicated reservation logic, a competing implementation, or a reason to discard any part of the existing module. The pre-existing `bookings` table (migration 003) is a separate, older, unrelated feature (banquet/event bookings) that this audit recommends leaving alone and not conflating with "Booking Management" going forward — but it is worth a short, explicit team note clarifying the two, precisely because the names are easy to confuse.

This report is the blueprint: apply, verify, then finish the two integration gaps — in that order.
