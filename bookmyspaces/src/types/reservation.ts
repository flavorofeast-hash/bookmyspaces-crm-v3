// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/types/reservation.ts
// V3 FOUNDATION — Reservation, Property, Pricing domain model
//
// Mirrors supabase/migrations/012_v3_foundation_schema.sql exactly. That
// migration is NOT yet applied to the live database (see its header) — these
// types describe the target shape so application code, tests, and future
// migrations can be written against a stable contract now, without waiting
// for a live-DB round trip that this sandbox can't perform anyway.
//
// Per the master specification's "Focus on the domain model first" scoping
// for today: this file defines the shapes only. Repository/service functions
// that read and write these tables (ReservationService, PricingEngine, etc.)
// are follow-up work once the migration is actually applied and can be
// tested against a real database.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Property ────────────────────────────────────────────────────────────────

/**
 * Known property slugs today. Deliberately a plain string type, not a union
 * literal of just these two — the whole point of the properties table is
 * that new properties are rows, not code changes. Use PropertySlug only as
 * a hint/autocomplete aid, never as an exhaustive check.
 */
export type PropertySlug = string

export interface Property {
  id: string
  name: string
  slug: PropertySlug
  address: string | null
  city: string | null
  gstNumber: string | null
  googleMapsUrl: string | null
  contactPhone: string | null
  contactEmail: string | null
  amenities: string[]
  images: string[]
  policies: string | null
  businessHours: Record<string, unknown>
  isActive: boolean
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export type InventoryType =
  | 'room'
  | 'suite'
  | 'apartment'
  | 'banquet_hall'
  | 'conference_hall'
  | 'rooftop'
  | 'restaurant_event_area'
  | 'wedding_venue'
  | 'birthday_venue'
  | 'meeting_room'

export interface InventoryItem {
  id: string
  propertyId: string
  inventoryType: InventoryType
  name: string
  description: string | null
  maxOccupancy: number | null
  baseCapacity: number | null
  isActive: boolean
}

// ─── Meal Plans ──────────────────────────────────────────────────────────────

export type MealPlanCode = 'room_only' | 'breakfast' | 'map' | 'ap'

export interface MealPlan {
  id: string
  propertyId: string
  code: MealPlanCode
  name: string
  description: string | null
  price: number
  isActive: boolean
}

// ─── Pricing Engine ──────────────────────────────────────────────────────────

export type RateType =
  | 'base'
  | 'weekend'
  | 'seasonal'
  | 'festival'
  | 'holiday'
  | 'corporate'
  | 'ota'
  | 'promotional'

export interface RatePlan {
  id: string
  inventoryItemId: string
  rateType: RateType
  /** ISO date (YYYY-MM-DD) or null for an open-ended/always-applicable rate. */
  startDate: string | null
  endDate: string | null
  price: number
  /** Higher priority wins when multiple rate plans overlap a date. */
  priority: number
  isActive: boolean
}

/**
 * Resolve the applicable price for an inventory item on a given date from a
 * set of candidate rate plans. Pure function — no DB access — so it can be
 * unit-tested without a live database and reused by both the reservation
 * quote flow and any future availability/pricing API.
 *
 * Selection rule: among rate plans whose date range includes `date` (or
 * whose range is fully open), pick the highest `priority`; ties break
 * toward the more specific rate_type in the order below (matches the
 * intuition that a festival override should beat a generic seasonal rate
 * even at equal priority, without requiring every caller to set priority
 * correctly).
 */
const RATE_TYPE_SPECIFICITY: Record<RateType, number> = {
  base: 0,
  seasonal: 1,
  weekend: 2,
  corporate: 3,
  promotional: 4,
  ota: 5,
  holiday: 6,
  festival: 7,
}

export function resolveApplicableRate(
  ratePlans: Pick<RatePlan, 'rateType' | 'startDate' | 'endDate' | 'price' | 'priority' | 'isActive'>[],
  date: string
): number | null {
  const candidates = ratePlans.filter((rp) => {
    if (!rp.isActive) return false
    const afterStart = !rp.startDate || rp.startDate <= date
    const beforeEnd = !rp.endDate || rp.endDate >= date
    return afterStart && beforeEnd
  })

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return RATE_TYPE_SPECIFICITY[b.rateType] - RATE_TYPE_SPECIFICITY[a.rateType]
  })

  return candidates[0].price
}

// ─── Add-on Services ─────────────────────────────────────────────────────────

export interface AddonService {
  id: string
  propertyId: string
  name: string
  category: string | null
  price: number
  isActive: boolean
}

export interface ReservationAddon {
  id: string
  reservationId: string
  addonServiceId: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

// ─── Reservation ─────────────────────────────────────────────────────────────

export type BookingSource =
  | 'direct'
  | 'website'
  | 'whatsapp'
  | 'phone'
  | 'walk_in'
  | 'referral'
  | 'booking_com'
  | 'agoda'
  | 'expedia'
  | 'airbnb'
  | 'other'

export type ReservationStatus =
  | 'inquiry'
  | 'tentative'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show'

/** Status transitions this domain considers valid. Mirrors the pattern in
 * src/modules/leads/lead-stage-manager.ts's VALID_TRANSITIONS — reused here
 * as the same shape, not copy-pasted logic, per the architecture review's
 * explicit recommendation to use that file as the template for a
 * Reservation status state machine. */
export const VALID_RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  inquiry: ['tentative', 'confirmed', 'cancelled'],
  tentative: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: [],
  no_show: [],
}

export function isValidReservationTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return VALID_RESERVATION_TRANSITIONS[from]?.includes(to) ?? false
}

export interface Reservation {
  id: string
  customerId: string | null

  guestName: string
  guestMobile: string | null
  guestEmail: string | null
  guestAddress: string | null
  guestIdProof: string | null
  guestNationality: string | null

  propertyId: string
  inventoryItemId: string
  roomCount: number

  checkInDate: string  // ISO date
  checkOutDate: string // ISO date
  nights: number
  adults: number
  children: number

  bookingSource: BookingSource
  status: ReservationStatus

  baseRoomRate: number
  discountAmount: number
  finalRoomRate: number
  mealPlanId: string | null
  mealPlanCharge: number

  specialRequests: string | null

  proposalId: string | null
  invoiceId: string | null

  /** Reservation commercial snapshot (migration 029) — copied from the originating proposal at creation time, when there is one. Reservation is the display/commercial source of truth once it exists; see src/lib/reservations/commercial-source.ts. NULL for walk-in reservations with no originating proposal. */
  packageName: string | null
  venue: string | null

  /** Business Package Engine (migration 044) — inherited from the originating proposal's business_package_id at creation time, same snapshot convention as packageName/venue above. NULL for a walk-in reservation, or one from a proposal with no business package. */
  businessPackageId: string | null
}
