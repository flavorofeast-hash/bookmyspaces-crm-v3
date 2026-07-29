// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/reservations/availability-service.ts
// V3 Day 2 — Reservation Platform foundation, business logic layer.
//
// NOT LIVE-TESTABLE YET — see property-service.ts's header; same caveat
// applies (reads from `reservations`, drafted in migration 012, not live).
//
// Availability rule: an inventory item is unavailable for a requested
// [checkIn, checkOut) range if any existing reservation for that item, in a
// non-cancelled/non-no-show status, overlaps that range. `room_count` is not
// factored in here deliberately — that would mean deciding how many units
// of a given inventory item exist and how overbooking should be prevented
// across them, which is a real product decision (single-unit rooms vs.
// multi-unit inventory) not yet made. Today: available means zero
// overlapping reservations, full stop. Documented as a known simplification.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import type { ReservationStatus } from '@/types/reservation'

const BLOCKING_STATUSES: ReservationStatus[] = ['inquiry', 'tentative', 'confirmed', 'checked_in']

export interface AvailabilityCheckResult {
  /**
   * 'unknown' means the query itself failed (DB error) -- we could not
   * verify availability either way. Distinct from 'unavailable' (query
   * succeeded, a real conflicting reservation exists). Added Sprint 1,
   * Priority 1: previously both collapsed into `available: false`, which
   * is indistinguishable from "genuinely fully booked" to every caller --
   * the precise gap the "unknown availability -> automatic escalation"
   * requirement calls out. `available` is kept unchanged (still true only
   * for 'available') so every existing caller/test keeps working as-is.
   */
  status: 'available' | 'unavailable' | 'unknown'
  available: boolean
  conflictingReservationIds: string[]
}

/**
 * Pure overlap-detection logic, extracted so it can be unit-tested without a
 * database. Two date ranges [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd AND bStart < aEnd (standard half-open interval overlap).
 */
export function dateRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd
}

export async function checkAvailability(
  inventoryItemId: string,
  checkInDate: string,
  checkOutDate: string,
  excludeReservationId?: string
): Promise<AvailabilityCheckResult> {
  const supabase = getSupabaseAdmin()

  // Overlap condition (aStart < bEnd && bStart < aEnd, see dateRangesOverlap)
  // pushed into the query itself via idx_reservations_dates
  // (supabase/migrations/012_v3_foundation_schema.sql), instead of fetching
  // every blocking reservation this inventory item has ever had and
  // filtering in application code. Caught during the Day 2 database review -
  // the original version scaled with total reservation history per item,
  // not with the (small) number of actually-conflicting rows.
  let query = supabase
    .from('reservations')
    .select('id, check_in_date, check_out_date')
    .eq('inventory_item_id', inventoryItemId)
    .in('status', BLOCKING_STATUSES)
    .lt('check_in_date', checkOutDate)
    .gt('check_out_date', checkInDate)

  if (excludeReservationId) {
    query = query.neq('id', excludeReservationId)
  }

  const { data, error } = await query

  if (error || !data) {
    // Fail closed AND distinguishable: if we can't verify availability,
    // don't claim it's available -- but also don't claim it's genuinely
    // booked. Callers (e.g. orchestration-executor.ts) treat 'unknown'
    // as "escalate to a human", not "tell the customer no".
    return { status: 'unknown', available: false, conflictingReservationIds: [] }
  }

  // Re-checked in application code as a defense-in-depth safety net (cheap
  // now that the SQL query already did the real filtering) - if this ever
  // disagrees with the query, that's a signal something about the date
  // comparison assumptions above is wrong, not something to silently trust.
  const conflicts = data.filter((r) => dateRangesOverlap(checkInDate, checkOutDate, r.check_in_date, r.check_out_date))

  return {
    status: conflicts.length === 0 ? 'available' : 'unavailable',
    available: conflicts.length === 0,
    conflictingReservationIds: conflicts.map((r) => r.id),
  }
}
