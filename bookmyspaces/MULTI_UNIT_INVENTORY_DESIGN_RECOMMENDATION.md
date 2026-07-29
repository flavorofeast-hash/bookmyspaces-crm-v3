# Multi-Unit Inventory — Design Recommendation

Written: 2026-07-29, Sprint 1 (Availability & Escalation). Per the user's explicit scope: **recommendation only — not implemented in this sprint.** Builds directly on the gap `availability-service.ts`'s own header has flagged since Day 2 ("`room_count` is not factored in here deliberately... a real product decision... not yet made") and `audit/RESERVATION_BOOKING_ARCHITECTURE_AUDIT.md`'s Finding 4, which names the same gap without proposing a resolution.

## The gap, precisely

Today, one `inventory_items` row = one bookable thing, and `checkAvailability(inventoryItemId, ...)` answers "is this exact row free for these dates" by checking for any overlapping `reservations` row against that same id. This is correct and sufficient as long as every bookable thing in the business really is unique — which happens to already be true for `inventory_type IN ('banquet_hall', 'rooftop', ...)` (Monurama has one rooftop, not three) — but breaks the moment a property has more than one physical unit that a customer would consider interchangeable (e.g., three "Deluxe Double" rooms). Today, each of those three rooms would need its own `inventory_items` row with its own name, and Aria (or a human operator) has no single "is a Deluxe Double available" question to ask — only "is Room 101 available," "is Room 102 available," "is Room 103 available," asked three separate times, with no shared concept tying them together as substitutable.

## Two candidate models

**Option A — quantity counter.** Add a `room_count INTEGER` (or `total_units`) column directly to `inventory_items`. One row = one room *type*, not one physical room. Availability becomes "count of overlapping reservations against this row < room_count," not "zero overlapping reservations." Reservations are never tied to a specific physical unit — only to the type.

- Simpler to implement: one new column, one changed comparison (`<` instead of `=== 0`) in `checkAvailability`.
- Matches how a small owner-operator naturally talks about inventory ("we have 3 Deluxe rooms"), which fits BookMySpaces' actual scale (per `PRODUCT_MASTER.md`, this is a handful of rooms per property today, not a 200-room hotel).
- Cannot answer "which specific room" — no way to track that Room 101 needs housekeeping after checkout while 102 and 103 don't, no way to honor a returning guest's request for "the same room as last time," and no way to price/describe individual rooms differently (floor, view, size) if they're collapsed into one row.
- Would require restructuring the *existing* data model (today's schema already gives each named room its own row) rather than extending it — a bigger, more disruptive change than Option B, despite sounding simpler.

**Option B — per-unit rows + a grouping field.** Keep one `inventory_items` row per physical unit (today's model, unchanged), and add a nullable `room_type_id` (or a plain `category TEXT`) column that groups interchangeable units together (e.g., three rows all carrying `room_type_id = 'deluxe-double'`). A new aggregate function, `checkCategoryAvailability(roomTypeId, checkIn, checkOut)`, loops the existing per-row `checkAvailability()` (unchanged, reused exactly as-is) across every row in that category and returns which specific units are free, not just a count.

- Additive to the current schema and current `checkAvailability()` — nothing about today's function or its tests needs to change; a new function is layered on top.
- Preserves per-room identity: housekeeping status, specific-room requests, per-room pricing/description differences all keep working exactly as they do today, for every property, including ones that never adopt grouping.
- Naturally answers both questions a real front desk needs: "is a Deluxe Double available" (category check) AND "which one do we assign" (still knows individual rooms).
- Slightly more upfront data-entry work per property (one row per physical room, not one row per type) — but this matches what already exists in the live data model today, so it's not new work, just a grouping label added on top of it.

## Recommendation: Option B

For BookMySpaces specifically — small, boutique properties where individual rooms plausibly differ (floor, view, size) and where "which exact room" genuinely matters for operations (housekeeping, VIP repeat-guest requests) — Option B is the better fit, and it is also the *lower-disruption* path precisely because it extends the existing per-unit schema instead of collapsing it. It also composes cleanly with `SOLUTION_ARCHITECTURE.md`'s 2→100+ property scalability goal: nothing about per-unit modeling breaks at a larger property; a quantity-counter model (Option A) would need to be re-decomposed into per-unit rows eventually anyway if any future property ever needs housekeeping/room-specific tracking, which is wasted work avoided by starting with Option B.

## If approved — phased implementation path (not started)

1. Add nullable `room_type_id UUID` (or `category TEXT`) to `inventory_items` via a new additive migration — every existing row defaults to `NULL` (ungrouped, today's exact behavior, zero regression).
2. Add `checkCategoryAvailability(roomTypeId, checkInDate, checkOutDate)` in `availability-service.ts`, built entirely on the existing, untouched `checkAvailability()` — no change to that function's contract.
3. Register a new `check_room_type_availability` tool-registry entry once a real caller needs "is a Deluxe Double available" as a distinct question from "is Room 101 available."
4. Defer any UI/Aria-copy changes ("2 of 3 Deluxe rooms available") until there's a real property with actual grouped inventory to test against — consistent with Decision 9's "ship, measure, learn" discipline.

## What this recommendation does NOT do

No migration, no schema change, no new function, and no change to `checkAvailability()`'s contract has been made as part of this document. This is a decision to make, not a change already applied.
