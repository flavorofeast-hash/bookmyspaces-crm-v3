// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/customers/lifetime-value.ts
// Revenue Platform pivot — Customer Lifetime Value.
//
// WHY THIS EXISTS: nothing in the codebase computed a per-customer revenue
// total anywhere before this — the closest things were the Revenue
// Dashboard's aggregate (fleet-wide, not per-customer) and each Proposal's
// own total_price (per-deal, not per-customer). Repeat-customer / CLV
// tracking directly serves the platform's revenue KPIs (repeat customers,
// customer lifetime value), so this is a small, focused, additive read —
// no new tables, no new writes.
//
// REVENUE SOURCE + DOUBLE-COUNTING RULE — same reasoning as
// src/app/api/dashboard/revenue/route.ts's `reservationRevenue` block
// (Priority 4, this same implementation pass): a reservation created by
// converting an accepted proposal carries that proposal's id in
// `reservations.proposal_id`. Counting both the proposal's total_price AND
// that reservation's final_room_rate would double-count the same sale. This
// module resolves it the same way the Revenue Dashboard did: sum every
// accepted proposal for this lead, then ADD ONLY reservations that are
// revenue-recognized (status confirmed/checked_in/checked_out — same set
// used everywhere else this session) AND have no proposal_id (i.e., a
// direct booking that never went through the proposal flow at all).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

export interface LifetimeValue {
  /** Sum of accepted-proposal revenue + proposal-less reservation revenue. See file header for the double-counting rule. */
  totalRevenue: number
  /** Count of accepted proposals + proposal-less revenue-recognized reservations — i.e. distinct paid/committed bookings, not double-counted. */
  bookingCount: number
  /** true when bookingCount > 1 — this lead has booked more than once. */
  isRepeatCustomer: boolean
  firstBookingAt: string | null
  lastBookingAt: string | null
  /** True if the `reservations` table (migration 012) wasn't queryable — totalRevenue/bookingCount then reflect proposals only, not a hard failure. */
  degraded: boolean
}

interface ProposalRow {
  id: string
  total_price: number | null
  accepted_at: string | null
}

interface ReservationRow {
  status: string | null
  final_room_rate: number | null
  meal_plan_charge: number | null
  proposal_id: string | null
  created_at: string | null
}

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])

export async function computeLifetimeValue(leadId: string): Promise<LifetimeValue> {
  const db = getSupabaseAdmin()

  const proposalsResult = await db
    .from('proposals')
    .select('id, total_price, accepted_at')
    .eq('lead_id', leadId)
    .not('accepted_at', 'is', null)

  const acceptedProposals = ((proposalsResult.data ?? []) as unknown as ProposalRow[])

  const reservationsResult = await db
    .from('reservations')
    .select('status, final_room_rate, meal_plan_charge, proposal_id, created_at')
    .eq('customer_id', leadId)

  const degraded = reservationsResult.error !== null
  const reservations = degraded ? [] : ((reservationsResult.data ?? []) as unknown as ReservationRow[])

  const standaloneReservations = reservations.filter(
    (r) => r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status) && r.proposal_id === null
  )

  const proposalRevenue = acceptedProposals.reduce((sum, p) => sum + (Number(p.total_price) || 0), 0)
  // FIX: final_room_rate already includes meal_plan_charge (it's the grand
  // total persisted at reservation creation — see reservation-workflow.ts's
  // grandTotal) — adding meal_plan_charge again here double-counted it.
  const reservationRevenue = standaloneReservations.reduce(
    (sum, r) => sum + (Number(r.final_room_rate) || 0), 0
  )

  const bookingDates = [
    ...acceptedProposals.map((p) => p.accepted_at).filter((d): d is string => !!d),
    ...standaloneReservations.map((r) => r.created_at).filter((d): d is string => !!d),
  ].sort()

  const bookingCount = acceptedProposals.length + standaloneReservations.length

  return {
    totalRevenue: proposalRevenue + reservationRevenue,
    bookingCount,
    isRepeatCustomer: bookingCount > 1,
    firstBookingAt: bookingDates[0] ?? null,
    lastBookingAt: bookingDates[bookingDates.length - 1] ?? null,
    degraded,
  }
}
