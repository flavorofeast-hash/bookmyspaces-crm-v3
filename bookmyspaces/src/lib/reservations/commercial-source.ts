// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/reservations/commercial-source.ts
// Option A architecture — Reservation is the commercial source of truth for
// every customer-facing financial document once one exists.
//
// Extracted (unchanged logic) from src/app/api/proposals/[id]/invoice/route.ts
// so Receipt, Payment Reminder, and Invoice Email can resolve the exact same
// figures instead of each independently reading proposal.total_price. This
// is the ONLY place that decision is made — every consumer below just reads
// the result.
//
// Read-only: never writes to `proposals`. Accepted proposals remain
// immutable historical documents; Proposal is the source of truth ONLY
// until a Reservation exists.
// ─────────────────────────────────────────────────────────────────────────────

import { getReservationById, getReservationByProposalId, getReservationAddons } from './reservation-service'
import { getMealPlanById } from './property-service'

export interface ReservationInvoiceAddon {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface ReservationInvoiceSource {
  reservationId: string
  propertyName: string
  inventoryName: string
  accommodationCharges: number
  mealPlanName: string | null
  mealPlanCharge: number
  addonLines: ReservationInvoiceAddon[]
  discountAmount: number
  /** reservations.final_room_rate — always internally consistent (accommodation + meal + add-ons − discount), see reservation-workflow.ts. */
  grandTotal: number
  /** reservations.package_name (migration 029) — snapshot copied from the originating proposal at creation time. Falls back to the proposal's package_name only when the reservation's own snapshot is NULL (reservations created before migration 029). */
  packageName: string | null
  /** reservations.venue (migration 029) — same snapshot/fallback rule as packageName. */
  venue: string | null
}

/**
 * Finds "the reservation this proposal became," in either direction:
 *   - proposal.reservation_id — set when this proposal was itself generated
 *     FROM a reservation that had none to begin with (the walk-in-booking
 *     invoice shim, src/lib/proposals/proposal-service.ts's
 *     createProposalFromReservation()).
 *   - reverse lookup on reservations.proposal_id — set when a reservation
 *     was created BY converting this (accepted) proposal (the normal
 *     Lead -> Proposal -> Accepted -> Reservation flow). This is the common
 *     case and the one every customer-facing document was previously
 *     getting wrong by reading proposal.total_price directly.
 * Read-only both ways — nothing is written back onto `proposals`.
 */
export async function resolveReservationSource(proposal: any): Promise<ReservationInvoiceSource | null> {
  const reservation = proposal.reservation_id
    ? await getReservationById(proposal.reservation_id)
    : await getReservationByProposalId(proposal.id)

  if (!reservation) return null

  const addonLines = await getReservationAddons(reservation.id)

  let mealPlanName: string | null = null
  if (reservation.mealPlanId && reservation.mealPlanCharge > 0) {
    const mealPlan = await getMealPlanById(reservation.mealPlanId)
    mealPlanName = mealPlan?.name ?? null
  }

  return {
    reservationId: reservation.id,
    propertyName: reservation.propertyName,
    inventoryName: reservation.inventoryName,
    accommodationCharges: reservation.baseRoomRate,
    mealPlanName,
    mealPlanCharge: reservation.mealPlanCharge,
    addonLines,
    discountAmount: reservation.discountAmount,
    grandTotal: reservation.finalRoomRate,
    // Reservation commercial snapshot (migration 029) — reservation.packageName/
    // venue is NULL only for reservations created before this migration (or a
    // walk-in reservation whose proposal itself never had these fields); the
    // fallback to the Proposal's own fields covers exactly that transition
    // window, not the general case (Reservation is still the source of truth
    // whenever it has its own value).
    packageName: reservation.packageName ?? proposal.package_name ?? null,
    venue: reservation.venue ?? proposal.venue ?? null,
  }
}
