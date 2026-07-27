// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/reservations/reservation-service.ts
// V3 Day 2 — Reservation Platform foundation, business logic layer.
//
// NOT LIVE-TESTABLE YET — see property-service.ts's header; same caveat
// applies (reads/writes `reservations`, drafted in migration 012, not live).
//
// Status transitions reuse isValidReservationTransition() from Day 1
// (src/types/reservation.ts), which is itself modeled on
// src/modules/leads/lead-stage-manager.ts's existing VALID_TRANSITIONS
// pattern per the architecture review's explicit recommendation — this
// service is the "connect it to a real table" half of that pattern, not a
// new state machine.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { isValidReservationTransition, type Reservation, type ReservationStatus, type InventoryType } from '@/types/reservation'
import { checkAvailability } from './availability-service'

/**
 * Add-on Services booking-flow integration (Reservation Platform
 * activation, Phase 4). Already-priced line item — pricing happens in
 * reservation-workflow.ts's priceAddons() (server-side lookup, never a
 * client-submitted price); this service layer only persists what it's
 * given, same posture as every other field on CreateReservationInput.
 */
export interface PricedAddonLine {
  addonServiceId: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface CreateReservationInput {
  customerId?: string | null
  guestName: string
  guestMobile?: string | null
  guestEmail?: string | null
  propertyId: string
  inventoryItemId: string
  checkInDate: string
  checkOutDate: string
  adults?: number
  children?: number
  roomCount?: number
  bookingSource?: Reservation['bookingSource']
  specialRequests?: string | null
  /** Set when this reservation originates from an accepted proposal (Sprint 3 — Convert Proposal -> Reservation). */
  proposalId?: string | null
  /** Meal Plan booking-flow integration (Reservation Platform activation, Phase 3). Pricing fields are computed by reservation-workflow.ts's createReservationWithQuote() — createReservation() itself just persists whatever it's given, same as every other field here. */
  mealPlanId?: string | null
  mealPlanCharge?: number
  baseRoomRate?: number
  discountAmount?: number
  finalRoomRate?: number
  /** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4). Already-priced by the caller — see PricedAddonLine. */
  addonLines?: PricedAddonLine[]
}

export type CreateReservationResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; error: 'unavailable'; conflictingReservationIds: string[] }
  | { ok: false; error: 'db_error'; message: string }

/**
 * Creates a reservation after checking availability — never creates an
 * overlapping booking for the same inventory item, mirroring "never create
 * duplicate customers" from Identity Resolution but for inventory instead
 * of identity. Starts in 'inquiry' status; callers use transitionStatus()
 * to move it forward, which enforces the same state machine everywhere
 * rather than letting callers set an arbitrary status on create.
 */
export async function createReservation(input: CreateReservationInput): Promise<CreateReservationResult> {
  const availability = await checkAvailability(input.inventoryItemId, input.checkInDate, input.checkOutDate)
  if (!availability.available) {
    return { ok: false, error: 'unavailable', conflictingReservationIds: availability.conflictingReservationIds }
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      customer_id: input.customerId ?? null,
      guest_name: input.guestName,
      guest_mobile: input.guestMobile ?? null,
      guest_email: input.guestEmail ?? null,
      property_id: input.propertyId,
      inventory_item_id: input.inventoryItemId,
      room_count: input.roomCount ?? 1,
      check_in_date: input.checkInDate,
      check_out_date: input.checkOutDate,
      adults: input.adults ?? 1,
      children: input.children ?? 0,
      booking_source: input.bookingSource ?? 'direct',
      status: 'inquiry',
      special_requests: input.specialRequests ?? null,
      proposal_id: input.proposalId ?? null,
      // Meal Plan booking-flow integration (Reservation Platform activation,
      // Phase 3). Previously these five columns were never set on create and
      // silently kept their DB defaults (0/null) regardless of what
      // calculatePrice() quoted — the Reservation Dashboard's "Active
      // Revenue" stat and the Reservation Details price breakdown both read
      // final_room_rate/meal_plan_charge, so leaving them unset made both
      // permanently show ₹0. Fixed here since a meaningful meal plan charge
      // is meaningless without the base room rate it's added to also being
      // persisted.
      base_room_rate: input.baseRoomRate ?? 0,
      discount_amount: input.discountAmount ?? 0,
      final_room_rate: input.finalRoomRate ?? 0,
      meal_plan_id: input.mealPlanId ?? null,
      meal_plan_charge: input.mealPlanCharge ?? 0,
    })
    .select('*')
    .single()

  if (error || !data) {
    return { ok: false, error: 'db_error', message: error?.message ?? 'Unknown error creating reservation' }
  }

  const reservation = mapRow(data)

  // Add-on Services booking-flow integration (Reservation Platform
  // activation, Phase 4). reservation_addons rows can only be written after
  // the reservation exists (they FK to reservation_id), so this is a second
  // insert, not part of the row above. Best-effort, same posture as
  // reservation-workflow.ts's activity-log writes: the reservation itself
  // is already created — and its total (final_room_rate) already has the
  // add-ons charge baked in via the caller's quote — so a failure here
  // degrades to "reservation exists, itemized add-on lines didn't save"
  // rather than losing the whole booking. Never worse than before this
  // integration existed, when reservation_addons was never written at all.
  if (input.addonLines && input.addonLines.length > 0) {
    try {
      await supabase.from('reservation_addons').insert(
        input.addonLines.map((line) => ({
          reservation_id: reservation.id,
          addon_service_id: line.addonServiceId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          total_price: line.totalPrice,
        }))
      )
    } catch {
      // Not fatal — see comment above.
    }
  }

  return { ok: true, reservation }
}

export type TransitionResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; error: 'invalid_transition'; from: ReservationStatus; to: ReservationStatus }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'db_error'; message: string }

export async function transitionReservationStatus(reservationId: string, toStatus: ReservationStatus): Promise<TransitionResult> {
  const supabase = getSupabaseAdmin()

  const { data: current, error: fetchError } = await supabase
    .from('reservations')
    .select('status')
    .eq('id', reservationId)
    .maybeSingle()

  if (fetchError) return { ok: false, error: 'db_error', message: fetchError.message }
  if (!current) return { ok: false, error: 'not_found' }

  const fromStatus = current.status as ReservationStatus
  if (!isValidReservationTransition(fromStatus, toStatus)) {
    return { ok: false, error: 'invalid_transition', from: fromStatus, to: toStatus }
  }

  const { data, error } = await supabase
    .from('reservations')
    .update({ status: toStatus })
    .eq('id', reservationId)
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: 'db_error', message: error?.message ?? 'Unknown error updating reservation' }

  return { ok: true, reservation: mapRow(data) }
}

// ─── Read paths: Reservation Dashboard / Reservation Details (Day 6) ───────
// The dashboard and details screens need property/inventory names alongside
// the reservation itself — added here (one query shape, one place) rather
// than as ad-hoc joins scattered across route files.

export interface ReservationWithJoins extends Reservation {
  propertyName: string
  inventoryName: string
  inventoryType: InventoryType | null
}

function mapRowWithJoins(row: Record<string, any>): ReservationWithJoins {
  const property = Array.isArray(row.properties) ? row.properties[0] : row.properties
  const inventoryItem = Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items

  return {
    ...mapRow(row),
    propertyName: property?.name ?? 'Unknown property',
    inventoryName: inventoryItem?.name ?? 'Unknown inventory',
    inventoryType: inventoryItem?.inventory_type ?? null,
  }
}

export interface ListReservationsFilters {
  status?: ReservationStatus[]
  checkInFrom?: string
  checkInTo?: string
  checkOutFrom?: string
  checkOutTo?: string
  propertyId?: string
  limit?: number
}

/**
 * Lists reservations (most imminent check-in first) with their property and
 * inventory item name/type joined in, for the Reservation Dashboard and
 * Calendar. Every filter is optional and additive (AND'd together) — the
 * dashboard composes these into "today's arrivals", "pending confirmations",
 * etc. rather than this function knowing about dashboard-specific concepts.
 */
export async function listReservations(filters: ListReservationsFilters = {}): Promise<ReservationWithJoins[]> {
  const supabase = getSupabaseAdmin()

  let query = supabase
    .from('reservations')
    .select('*, properties(name), inventory_items(name, inventory_type)')
    .order('check_in_date', { ascending: true })
    .limit(filters.limit ?? 200)

  if (filters.status && filters.status.length > 0) query = query.in('status', filters.status)
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  if (filters.checkInFrom) query = query.gte('check_in_date', filters.checkInFrom)
  if (filters.checkInTo) query = query.lte('check_in_date', filters.checkInTo)
  if (filters.checkOutFrom) query = query.gte('check_out_date', filters.checkOutFrom)
  if (filters.checkOutTo) query = query.lte('check_out_date', filters.checkOutTo)

  const { data, error } = await query
  if (error || !data) return []
  return data.map(mapRowWithJoins)
}

/** Single reservation with the same property/inventory joins, for the Reservation Details screen. */
export async function getReservationById(id: string): Promise<ReservationWithJoins | null> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('reservations')
    .select('*, properties(name), inventory_items(name, inventory_type)')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  return mapRowWithJoins(data)
}

function mapRow(row: Record<string, any>): Reservation {
  return {
    id: row.id,
    customerId: row.customer_id,
    guestName: row.guest_name,
    guestMobile: row.guest_mobile,
    guestEmail: row.guest_email,
    guestAddress: row.guest_address,
    guestIdProof: row.guest_id_proof,
    guestNationality: row.guest_nationality,
    propertyId: row.property_id,
    inventoryItemId: row.inventory_item_id,
    roomCount: row.room_count,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    nights: row.nights,
    adults: row.adults,
    children: row.children,
    bookingSource: row.booking_source,
    status: row.status,
    baseRoomRate: Number(row.base_room_rate) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    finalRoomRate: Number(row.final_room_rate) || 0,
    mealPlanId: row.meal_plan_id,
    mealPlanCharge: Number(row.meal_plan_charge) || 0,
    specialRequests: row.special_requests,
    proposalId: row.proposal_id,
    invoiceId: row.invoice_id,
  }
}
