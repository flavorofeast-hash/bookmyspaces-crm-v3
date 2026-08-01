// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/reservations/reservation-workflow.ts
// V3 Day 4 — Priority 4: complete the first usable Reservation workflow.
//
// Orchestrates Day 2's reservation building blocks (availability-service.ts,
// reservation-service.ts) plus Day 2's pricing-service.ts into the five
// named operations the master spec asks for: Check Availability, Calculate
// Price, Create Reservation, Confirm Reservation, Cancel Reservation. No new
// business logic is introduced here beyond the orchestration itself —
// checkAvailability/createReservation/transitionReservationStatus are
// reused exactly as Day 2 wrote them.
//
// "Connect to: CRM / Pricing Engine / Proposal Module / Timeline":
//   - Pricing Engine -> calculatePrice() below, via pricing-service.ts's
//     getInventoryItemRate()
//   - CRM -> every state-changing operation writes an `activity_logs` row
//     (the same LIVE table src/app/api/leads/route.ts and followups/route.ts
//     already write to — reused, not duplicated)
//   - Timeline -> automatic: src/lib/timeline/timeline-service.ts already
//     reads both `reservations` and `activity_logs`, so nothing extra is
//     needed here for a reservation to show up on a customer's timeline
//   - Proposal Module -> reservations.proposal_id (migration 012) can be
//     set at creation time when a reservation originates from an accepted
//     proposal; linking the other direction (proposals.reservation_id,
//     migration 013) is src/lib/proposals/proposal-service.ts's job, kept
//     separate so this file doesn't need to know about proposal internals
//
// NOT LIVE-TESTABLE YET, same as everything built on migration 012's
// `reservations` table (see reservation-service.ts's header).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import type { Reservation } from '@/types/reservation'
import { checkAvailability, type AvailabilityCheckResult } from './availability-service'
import { createReservation, transitionReservationStatus, type CreateReservationInput, type CreateReservationResult, type TransitionResult, type PricedAddonLine } from './reservation-service'
import { getInventoryItemRate } from '@/lib/pricing/pricing-service'
import { getMealPlanById, getAddonServicesByIds } from './property-service'

export interface PriceQuote {
  inventoryItemId: string
  checkInDate: string
  checkOutDate: string
  nights: number
  roomCount: number
  /** Nights this quote has a real rate_plans price for. */
  pricedNights: number
  /** Nights with no matching rate_plans row — quote is a lower bound, not final, when this is > 0. */
  unpricedNights: number
  nightlyRates: number[]
  subtotal: number
  /** Meal Plan booking-flow integration (Reservation Platform activation, Phase 3). 0 when no mealPlanId was quoted. */
  mealPlanId: string | null
  mealPlanCharge: number
  /** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4). Empty/0 when no addons were quoted. */
  addonLines: PricedAddonLine[]
  addonsCharge: number
  /** subtotal + mealPlanCharge + addonsCharge — what the reservation is actually persisted with (final_room_rate + meal_plan_charge, plus the reservation_addons rows). */
  grandTotal: number
  isComplete: boolean
}

/**
 * Meal Plan booking-flow integration (Reservation Platform activation,
 * Phase 3). Looks the meal plan's price up server-side rather than trusting
 * a client-submitted charge — same "never trust the client for a price"
 * posture as calculatePrice()'s rate_plans lookup below. Charge convention:
 * meal_plans.price is a per-night, per-room amount (matches how rate_plans
 * prices are applied in the loop below), so the total charge for the stay is
 * price x nights x roomCount.
 */
export async function calculateMealPlanCharge(
  mealPlanId: string | null | undefined,
  nights: number,
  roomCount = 1
): Promise<number> {
  if (!mealPlanId) return 0
  const mealPlan = await getMealPlanById(mealPlanId)
  if (!mealPlan) return 0
  return mealPlan.price * nights * roomCount
}

// ─── Add-on Services booking-flow integration (Reservation Platform activation, Phase 4) ──

/** What a caller (API route) submits — a raw selection, unpriced. */
export interface AddonLineInput {
  addonServiceId: string
  quantity: number
}

// PricedAddonLine (what gets quoted back and, on create, persisted into
// reservation_addons) is defined in reservation-service.ts, next to
// CreateReservationInput.addonLines that consumes it, and re-exported below
// so callers of this file don't also need to import from reservation-service.

/**
 * Prices a caller-submitted add-on selection server-side — same "never trust
 * the client for a price" posture as calculateMealPlanCharge() above.
 * Unknown or inactive addon_service ids are silently dropped from the
 * result rather than throwing (an add-on could be deactivated between the
 * operator loading the form and submitting it — that's not a request
 * error, the line item just doesn't get priced/added).
 */
export async function priceAddons(
  addons: AddonLineInput[] | null | undefined
): Promise<{ lines: PricedAddonLine[]; totalCharge: number }> {
  if (!addons || addons.length === 0) return { lines: [], totalCharge: 0 }

  const ids = Array.from(new Set(addons.map((a) => a.addonServiceId)))
  const services = await getAddonServicesByIds(ids)
  const byId = new Map(services.map((s) => [s.id, s]))

  const lines: PricedAddonLine[] = []
  for (const addon of addons) {
    const service = byId.get(addon.addonServiceId)
    if (!service) continue
    const quantity = Math.max(1, Math.floor(addon.quantity))
    lines.push({
      addonServiceId: service.id,
      name: service.name,
      quantity,
      unitPrice: service.price,
      totalPrice: service.price * quantity,
    })
  }

  const totalCharge = lines.reduce((sum, line) => sum + line.totalPrice, 0)
  return { lines, totalCharge }
}

function enumerateNights(checkInDate: string, checkOutDate: string): string[] {
  const nights: string[] = []
  const cursor = new Date(checkInDate + 'T00:00:00Z')
  const end = new Date(checkOutDate + 'T00:00:00Z')
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return nights
}

/**
 * Calculate Price — sums the applicable rate_plans price for every night of
 * the stay (per room), via pricing-service.ts's getInventoryItemRate(). If
 * any night has no matching rate plan, the quote is marked incomplete
 * (isComplete: false) rather than silently under-quoting — callers should
 * not present an incomplete quote as final.
 */
export async function calculatePrice(
  inventoryItemId: string,
  checkInDate: string,
  checkOutDate: string,
  roomCount = 1,
  /** Meal Plan booking-flow integration (Reservation Platform activation, Phase 3). Optional — omitted/null means no meal plan quoted, matching every existing caller that predates this parameter. */
  mealPlanId?: string | null,
  /** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4). Optional — omitted/empty means no add-ons quoted, matching every existing caller that predates this parameter. */
  addons?: AddonLineInput[] | null
): Promise<PriceQuote> {
  const nights = enumerateNights(checkInDate, checkOutDate)
  const rates = await Promise.all(nights.map((date) => getInventoryItemRate(inventoryItemId, date)))

  const nightlyRates = rates.map((r) => r ?? 0)
  const pricedNights = rates.filter((r) => r !== null).length
  const unpricedNights = nights.length - pricedNights
  const subtotal = nightlyRates.reduce((sum, r) => sum + r, 0) * roomCount
  const mealPlanCharge = await calculateMealPlanCharge(mealPlanId, nights.length, roomCount)
  const { lines: addonLines, totalCharge: addonsCharge } = await priceAddons(addons)

  return {
    inventoryItemId,
    checkInDate,
    checkOutDate,
    nights: nights.length,
    roomCount,
    pricedNights,
    unpricedNights,
    nightlyRates,
    subtotal,
    mealPlanId: mealPlanId ?? null,
    mealPlanCharge,
    addonLines,
    addonsCharge,
    grandTotal: subtotal + mealPlanCharge + addonsCharge,
    isComplete: unpricedNights === 0 && nights.length > 0,
  }
}

async function logActivity(leadId: string | null, action: string, description: string, metadata: Record<string, unknown>): Promise<void> {
  if (!leadId) return
  try {
    const supabase = getSupabaseAdmin()
    await supabase.from('activity_logs').insert({ lead_id: leadId, action, description, performed_by: 'system', metadata })
  } catch {
    // Activity logging is CRM visibility, not a correctness requirement —
    // never let a logging failure fail the reservation operation itself.
  }
}

export interface CreateReservationWithQuoteInput extends CreateReservationInput {
  /** Populated onto activity_logs / used for the CRM trail — separate from customerId, which is the reservations.customer_id FK. */
  crmLeadId?: string | null
  /** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4). Raw, unpriced selection — priced here via priceAddons() before being persisted. */
  addons?: AddonLineInput[] | null
}

export interface CreateReservationWithQuoteResult {
  reservationResult: CreateReservationResult
  quote: PriceQuote | null
}

/**
 * Check Availability -> Calculate Price -> Create Reservation, in one call.
 * Availability is still checked again inside createReservation() itself
 * (defense in depth against a race between the two calls) — this wrapper's
 * job is just to attach a price quote and a CRM activity entry, not to
 * change createReservation()'s own availability guarantee.
 */
export async function createReservationWithQuote(
  input: CreateReservationWithQuoteInput
): Promise<CreateReservationWithQuoteResult> {
  const availability = await checkAvailability(input.inventoryItemId, input.checkInDate, input.checkOutDate)
  if (!availability.available) {
    return {
      reservationResult: { ok: false, error: 'unavailable', conflictingReservationIds: availability.conflictingReservationIds },
      quote: null,
    }
  }

  const quote = await calculatePrice(input.inventoryItemId, input.checkInDate, input.checkOutDate, input.roomCount ?? 1, input.mealPlanId, input.addons)

  // P0 FIX — reservation amount becomes ₹0 (root cause confirmed via full
  // flow-mapping investigation, see docs/sprints for the report). rate_plans
  // (migration 012, per-inventory-item/per-night pricing) is never
  // auto-seeded from `packages` — most inventory items have zero rows in
  // it, so calculatePrice() legitimately quotes 0 for any date with no
  // configured rate plan. When this reservation originates from an
  // ACCEPTED proposal, that proposal's own total_price (priced from the
  // live, always-populated `packages` table via resolvePackagePrice() —
  // see src/app/api/proposals/route.ts) is the customer-facing, already
  // agreed commercial number and is used in place of the rate_plans quote.
  //
  // Scoped narrowly on purpose, per investigation + approval:
  //   - Only when input.proposalId is set (Flow B: Accepted Proposal ->
  //     Reservation). Flow A (walk-in, reservations/page.tsx's New
  //     Reservation modal with no fromProposalId) never sends a
  //     proposalId — that UI has no field for it — so this branch never
  //     runs for a walk-in and rate_plans pricing is untouched.
  //   - Flow C (createManualBlock(), src/app/api/reservations/block/route.ts)
  //     never calls this function at all — its ₹0 is intentional (no
  //     guest, no sale) and is completely unaffected.
  //   - Only inherits when the linked proposal actually exists, is
  //     status='accepted' (not draft/sent/rejected — an unaccepted
  //     proposal's number isn't a confirmed commercial commitment yet),
  //     and total_price > 0 (never trust a zero/negative value as an
  //     override — falls back to the rate_plans quote instead).
  let baseRoomRate = quote.subtotal
  let finalRoomRate = quote.grandTotal
  let pricingSource: 'proposal' | 'rate_plan' = 'rate_plan'

  if (input.proposalId) {
    const supabase = getSupabaseAdmin()
    const { data: proposal } = await supabase
      .from('proposals')
      .select('status, total_price, base_price')
      .eq('id', input.proposalId)
      .maybeSingle()

    if (proposal && proposal.status === 'accepted' && Number(proposal.total_price) > 0) {
      baseRoomRate = Number(proposal.base_price) || Number(proposal.total_price)
      finalRoomRate = Number(proposal.total_price)
      pricingSource = 'proposal'
    }
  }

  // Meal Plan / Add-on Services booking-flow integration (Reservation
  // Platform activation, Phases 3-4): the quote's pricing (room subtotal +
  // meal plan charge + priced add-on lines) is now persisted onto the
  // reservation itself, not just returned to the caller.
  const reservationResult = await createReservation({
    ...input,
    baseRoomRate,
    finalRoomRate,
    mealPlanId: quote.mealPlanId,
    mealPlanCharge: quote.mealPlanCharge,
    addonLines: quote.addonLines,
  })

  if (reservationResult.ok) {
    await logActivity(
      input.crmLeadId ?? input.customerId ?? null,
      'reservation_created',
      `Reservation created for ${input.checkInDate} -> ${input.checkOutDate}`,
      { reservationId: reservationResult.reservation.id, subtotal: quote.subtotal, finalRoomRate, pricingSource, mealPlanCharge: quote.mealPlanCharge, addonsCharge: quote.addonsCharge, isComplete: quote.isComplete }
    )
  }

  return { reservationResult, quote }
}

// ─── Manual availability override (Sprint 1, Priority 1) ───────────────────
// Smallest practical admin capability for "staff needs to block a room/hall
// for dates with no real guest" (maintenance, owner use, a booking taken by
// phone before it can be entered properly, etc.). Deliberately NOT a new
// mechanism: createReservation() already blocks availability for any
// reservation in an 'inquiry'/'tentative'/'confirmed'/'checked_in' status
// (availability-service.ts's BLOCKING_STATUSES) -- this just calls it
// directly, skipping calculatePrice()/createReservationWithQuote() entirely
// (a manual block has no guest, no rate, no meal plan to quote), and tags
// the reservation so it's identifiable as a block rather than a real
// booking in every existing list/dashboard view that already reads
// `reservations` (Reservation Dashboard, Calendar, Customers) -- no new
// table, no new status, no new field.

export interface CreateManualBlockInput {
  propertyId: string
  inventoryItemId: string
  checkInDate: string
  checkOutDate: string
  /** Why this is blocked -- required so every block is self-explanatory to whoever looks at it later (Reservation Dashboard shows guestName; this becomes part of it). */
  reason: string
  /** Staff member creating the block, for the CRM activity trail. Optional -- activity logging degrades gracefully without it, same as every other logActivity() call in this file. */
  createdBy?: string | null
}

const MANUAL_BLOCK_SOURCE: Reservation['bookingSource'] = 'other'

/**
 * Manual availability override -- blocks an inventory item for a date range
 * without a real guest. Reuses createReservation() exactly as-is (same
 * availability check, same conflict handling, same DB write) -- the only
 * difference from a normal booking is which fields this wrapper supplies.
 */
export async function createManualBlock(input: CreateManualBlockInput): Promise<CreateReservationResult> {
  // No logActivity() call here, deliberately: that helper no-ops without a
  // leadId (see its own definition above), and a manual block has no lead
  // -- calling it would silently do nothing while looking like an audit
  // trail was written. The reservation row itself IS the audit trail: it's
  // clearly tagged (guestName/specialRequests/bookingSource) and already
  // shows up in every existing view that reads `reservations` (Reservation
  // Dashboard, Calendar) -- no separate log needed to find it later.
  const specialRequestsSuffix = input.createdBy ? ` (blocked by ${input.createdBy})` : ''

  return createReservation({
    guestName: `BLOCKED — ${input.reason}`,
    propertyId: input.propertyId,
    inventoryItemId: input.inventoryItemId,
    checkInDate: input.checkInDate,
    checkOutDate: input.checkOutDate,
    roomCount: 1,
    bookingSource: MANUAL_BLOCK_SOURCE,
    specialRequests: `Manual availability block. Reason: ${input.reason}${specialRequestsSuffix}`,
    baseRoomRate: 0,
    finalRoomRate: 0,
  })
}

/** Confirm Reservation — named wrapper around the existing state machine (inquiry/tentative -> confirmed). */
export async function confirmReservation(reservationId: string, crmLeadId?: string | null): Promise<TransitionResult> {
  const result = await transitionReservationStatus(reservationId, 'confirmed')
  if (result.ok) {
    await logActivity(crmLeadId ?? result.reservation.customerId, 'reservation_confirmed', `Reservation ${reservationId} confirmed`, { reservationId })

    // Journey stage 3 (Customer Journey Automation, Priority 3): "Booking
    // confirmed -> message". AUDIT FINDING: WHATSAPP_MESSAGES.bookingConfirmed()
    // already existed but had zero callers repo-wide — this is the first
    // wire-up, not new copy. Fire-and-forget: never let a WhatsApp send
    // failure roll back or block the confirmation itself.
    if (result.reservation.guestMobile) {
      const { enqueueMessage } = await import('@/lib/queue')
      const { WHATSAPP_MESSAGES } = await import('@/lib/templates')
      await enqueueMessage({
        phone: result.reservation.guestMobile,
        message: WHATSAPP_MESSAGES.bookingConfirmed({
          name: result.reservation.guestName,
          date: result.reservation.checkInDate,
        }),
        type: 'session',
        metadata: { journey: 'booking_confirmed', reservation_id: reservationId, lead_id: crmLeadId ?? result.reservation.customerId ?? null },
      }).catch(() => null)
    }
  }
  return result
}

/** Cancel Reservation — named wrapper around the existing state machine (-> cancelled). */
export async function cancelReservation(reservationId: string, reason: string | null, crmLeadId?: string | null): Promise<TransitionResult> {
  const result = await transitionReservationStatus(reservationId, 'cancelled')
  if (result.ok) {
    await logActivity(crmLeadId ?? result.reservation.customerId, 'reservation_cancelled', reason ?? `Reservation ${reservationId} cancelled`, { reservationId, reason })
  }
  return result
}

// V3 Day 6 — Operator Experience sprint. The Reservation Details screen
// needs check-in/check-out actions alongside confirm/cancel; added as the
// same named-wrapper-plus-activity-log pattern rather than routes calling
// transitionReservationStatus() directly and forgetting the CRM trail.

/** Check In — named wrapper around the existing state machine (confirmed -> checked_in). */
export async function checkInReservation(reservationId: string, crmLeadId?: string | null): Promise<TransitionResult> {
  const result = await transitionReservationStatus(reservationId, 'checked_in')
  if (result.ok) {
    await logActivity(crmLeadId ?? result.reservation.customerId, 'reservation_checked_in', `Reservation ${reservationId} checked in`, { reservationId })

    // Journey stage: "Check-in message" (Customer Journey Automation).
    // Fire-and-forget, same pattern as confirmReservation()'s booking-
    // confirmed message above — never let a WhatsApp send failure roll
    // back or block the check-in itself.
    if (result.reservation.guestMobile) {
      const { enqueueMessage } = await import('@/lib/queue')
      const { WHATSAPP_MESSAGES } = await import('@/lib/templates')
      await enqueueMessage({
        phone: result.reservation.guestMobile,
        message: WHATSAPP_MESSAGES.checkInMessage({
          name: result.reservation.guestName,
          checkOutDate: result.reservation.checkOutDate,
        }),
        type: 'session',
        metadata: { journey: 'check_in', reservation_id: reservationId, lead_id: crmLeadId ?? result.reservation.customerId ?? null },
      }).catch(() => null)
    }
  }
  return result
}

/** Check Out — named wrapper around the existing state machine (checked_in -> checked_out). */
export async function checkOutReservation(reservationId: string, crmLeadId?: string | null): Promise<TransitionResult> {
  const result = await transitionReservationStatus(reservationId, 'checked_out')
  if (result.ok) {
    await logActivity(crmLeadId ?? result.reservation.customerId, 'reservation_checked_out', `Reservation ${reservationId} checked out`, { reservationId })

    // Journey stage: "Check-out message" — immediate farewell. The
    // stay-lifecycle cron separately sends postStayThankYou the following
    // day, so this and that are deliberately two different messages at
    // two different times, not a duplicate.
    if (result.reservation.guestMobile) {
      const { enqueueMessage } = await import('@/lib/queue')
      const { WHATSAPP_MESSAGES } = await import('@/lib/templates')
      await enqueueMessage({
        phone: result.reservation.guestMobile,
        message: WHATSAPP_MESSAGES.checkOutMessage({ name: result.reservation.guestName }),
        type: 'session',
        metadata: { journey: 'check_out', reservation_id: reservationId, lead_id: crmLeadId ?? result.reservation.customerId ?? null },
      }).catch(() => null)
    }
  }
  return result
}

export type { AvailabilityCheckResult, PricedAddonLine }
