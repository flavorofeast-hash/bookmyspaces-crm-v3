import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
  createReservation: vi.fn(),
  transitionReservationStatus: vi.fn(),
  getInventoryItemRate: vi.fn(),
  getMealPlanById: vi.fn(),
  // P0 fix (reservation amount becomes ₹0) — createReservationWithQuote()
  // now looks up the linked proposal's status/total_price/base_price when
  // input.proposalId is set. Defaults to "no proposal found" so every
  // existing test (which never sets proposalId) is unaffected.
  proposalLookup: vi.fn(),
  // Production fix (proposal<->reservation link-back) — controls the
  // .update(...).eq(...).is(...) call's result. Defaults to success
  // (error: null) so every existing test is unaffected.
  proposalLinkUpdate: vi.fn(),
}))

const proposalUpdates: Array<{ id: unknown; patch: Record<string, unknown> }> = []

vi.mock('./availability-service', () => ({
  checkAvailability: mocks.checkAvailability,
}))

vi.mock('./reservation-service', () => ({
  createReservation: mocks.createReservation,
  transitionReservationStatus: mocks.transitionReservationStatus,
}))

vi.mock('@/lib/pricing/pricing-service', () => ({
  getInventoryItemRate: mocks.getInventoryItemRate,
}))

// Meal Plan booking-flow integration (Reservation Platform activation, Phase 3).
vi.mock('./property-service', () => ({
  getMealPlanById: mocks.getMealPlanById,
}))

const activityInserts: Record<string, unknown>[] = []
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      // P0 fix — the proposals lookup uses .select().eq().maybeSingle(),
      // a different chain shape than the activity_logs .insert() every
      // other test in this file already exercises. Keeping both on one
      // mocked client, switched on table name, so no existing test needs
      // to change.
      if (table === 'proposals') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(mocks.proposalLookup()),
            }),
          }),
          // Production fix (proposal<->reservation link-back) — a different
          // chain shape again (.update().eq().is()), same "switch on table
          // name, one mocked client" approach as the select-branch above.
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: unknown) => ({
              is: () => {
                proposalUpdates.push({ id, patch })
                return Promise.resolve(mocks.proposalLinkUpdate())
              },
            }),
          }),
        }
      }
      return {
        insert: (row: Record<string, unknown>) => {
          activityInserts.push(row)
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }),
}))

import { calculatePrice, calculateMealPlanCharge, createReservationWithQuote, createManualBlock, confirmReservation, cancelReservation, checkInReservation, checkOutReservation } from './reservation-workflow'

const baseInput = {
  guestName: 'Priya Sharma',
  propertyId: 'prop-1',
  inventoryItemId: 'item-1',
  checkInDate: '2026-08-01',
  checkOutDate: '2026-08-03',
}

describe('calculatePrice', () => {
  beforeEach(() => {
    mocks.getInventoryItemRate.mockReset()
    mocks.getMealPlanById.mockReset()
  })

  it('sums a nightly rate across each night of the stay', async () => {
    mocks.getInventoryItemRate.mockResolvedValueOnce(5000).mockResolvedValueOnce(5500)

    const quote = await calculatePrice('item-1', '2026-08-01', '2026-08-03')

    expect(quote.nights).toBe(2)
    expect(quote.nightlyRates).toEqual([5000, 5500])
    expect(quote.subtotal).toBe(10500)
    expect(quote.isComplete).toBe(true)
    expect(quote.mealPlanCharge).toBe(0)
    expect(quote.grandTotal).toBe(10500)
  })

  it('multiplies by roomCount', async () => {
    mocks.getInventoryItemRate.mockResolvedValue(5000)
    const quote = await calculatePrice('item-1', '2026-08-01', '2026-08-02', 3)
    expect(quote.subtotal).toBe(15000)
  })

  it('marks the quote incomplete when a night has no matching rate plan', async () => {
    mocks.getInventoryItemRate.mockResolvedValueOnce(5000).mockResolvedValueOnce(null)

    const quote = await calculatePrice('item-1', '2026-08-01', '2026-08-03')

    expect(quote.pricedNights).toBe(1)
    expect(quote.unpricedNights).toBe(1)
    expect(quote.isComplete).toBe(false)
  })

  // Meal Plan booking-flow integration (Reservation Platform activation, Phase 3).
  it('adds the meal plan charge (price x nights x roomCount) onto grandTotal without touching subtotal', async () => {
    mocks.getInventoryItemRate.mockResolvedValueOnce(5000).mockResolvedValueOnce(5000)
    mocks.getMealPlanById.mockResolvedValue({ id: 'mp-1', propertyId: 'prop-1', code: 'breakfast', name: 'Breakfast', description: null, price: 500, isActive: true })

    const quote = await calculatePrice('item-1', '2026-08-01', '2026-08-03', 2, 'mp-1')

    expect(quote.subtotal).toBe(20000) // 2 nights x 5000 x 2 rooms
    expect(quote.mealPlanCharge).toBe(2000) // 500 x 2 nights x 2 rooms
    expect(quote.grandTotal).toBe(22000)
    expect(quote.mealPlanId).toBe('mp-1')
  })

  it('treats an unknown mealPlanId as no meal plan rather than throwing', async () => {
    mocks.getInventoryItemRate.mockResolvedValue(5000)
    mocks.getMealPlanById.mockResolvedValue(null)

    const quote = await calculatePrice('item-1', '2026-08-01', '2026-08-02', 1, 'missing-plan')

    expect(quote.mealPlanCharge).toBe(0)
    expect(quote.grandTotal).toBe(quote.subtotal)
  })
})

describe('calculateMealPlanCharge', () => {
  beforeEach(() => mocks.getMealPlanById.mockReset())

  it('returns 0 without a lookup when no mealPlanId is given', async () => {
    expect(await calculateMealPlanCharge(null, 3, 2)).toBe(0)
    expect(await calculateMealPlanCharge(undefined, 3, 2)).toBe(0)
    expect(mocks.getMealPlanById).not.toHaveBeenCalled()
  })

  it('multiplies the meal plan price by nights and roomCount', async () => {
    mocks.getMealPlanById.mockResolvedValue({ id: 'mp-1', propertyId: 'prop-1', code: 'map', name: 'MAP', description: null, price: 800, isActive: true })

    expect(await calculateMealPlanCharge('mp-1', 4, 2)).toBe(6400) // 800 x 4 x 2
  })
})

describe('createReservationWithQuote', () => {
  beforeEach(() => {
    mocks.checkAvailability.mockReset()
    mocks.createReservation.mockReset()
    mocks.getInventoryItemRate.mockReset().mockResolvedValue(5000)
    mocks.getMealPlanById.mockReset()
    mocks.proposalLookup.mockReset().mockReturnValue({ data: null, error: null })
    mocks.proposalLinkUpdate.mockReset().mockReturnValue({ error: null })
    activityInserts.length = 0
    proposalUpdates.length = 0
  })

  it('returns unavailable without creating a reservation when the dates conflict', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: false, conflictingReservationIds: ['r1'] })

    const result = await createReservationWithQuote(baseInput)

    expect(result.reservationResult).toEqual({ ok: false, error: 'unavailable', conflictingReservationIds: ['r1'] })
    expect(result.quote).toBeNull()
    expect(mocks.createReservation).not.toHaveBeenCalled()
    expect(activityInserts).toHaveLength(0)
  })

  it('creates the reservation, attaches a quote, and logs a CRM activity entry', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    const result = await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', crmLeadId: 'lead-1' })

    expect(result.reservationResult.ok).toBe(true)
    expect(result.quote?.subtotal).toBe(10000)
    expect(activityInserts).toHaveLength(1)
    expect(activityInserts[0]).toMatchObject({ lead_id: 'lead-1', action: 'reservation_created' })
  })

  it('does not log activity when reservation creation fails after availability passes', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: false, error: 'db_error', message: 'boom' })

    await createReservationWithQuote(baseInput)

    expect(activityInserts).toHaveLength(0)
  })

  // Meal Plan booking-flow integration (Reservation Platform activation,
  // Phase 3) — the seam this test exists to catch: the quote's computed
  // pricing must actually reach createReservation()'s persisted fields, not
  // just come back in the returned `quote` object.
  it('persists the quoted room rate and meal plan charge onto the reservation it creates', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.getMealPlanById.mockResolvedValue({ id: 'mp-1', propertyId: 'prop-1', code: 'breakfast', name: 'Breakfast', description: null, price: 500, isActive: true })

    const result = await createReservationWithQuote({ ...baseInput, mealPlanId: 'mp-1' })

    expect(result.quote?.subtotal).toBe(10000) // 2 nights x 5000
    expect(result.quote?.mealPlanCharge).toBe(1000) // 500 x 2 nights
    expect(result.quote?.grandTotal).toBe(11000)

    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRoomRate: 10000,
        finalRoomRate: 11000,
        mealPlanId: 'mp-1',
        mealPlanCharge: 1000,
      })
    )
  })

  // ── P0 fix — reservation amount becomes ₹0 ──────────────────────────────
  // Flow A (walk-in, no proposalId) vs Flow B (Accepted Proposal ->
  // Reservation, proposalId set) verification, per the approved fix scope:
  // only an ACCEPTED proposal with total_price > 0 overrides the rate_plans
  // quote; everything else (no proposalId, proposal not accepted, proposal
  // has no positive total_price, proposal not found) keeps today's
  // rate_plans-derived pricing exactly as before.

  it('Flow A — walk-in (no proposalId): prices from rate_plans and tags pricingSource "rate_plan", never looking up a proposal', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    await createReservationWithQuote({ ...baseInput, customerId: 'lead-1' }) // baseInput has no proposalId

    expect(mocks.proposalLookup).not.toHaveBeenCalled()
    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 10000, finalRoomRate: 10000 })
    )
    expect(activityInserts[0]).toMatchObject({ metadata: expect.objectContaining({ pricingSource: 'rate_plan' }) })
  })

  it('Flow B — proposal accepted with a real total_price: finalRoomRate comes from the proposal, not rate_plans, tagged pricingSource "proposal"', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 50000, base_price: 45000 }, error: null })

    const result = await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-abc' })

    // The rate_plans quote is still computed (still returned to the caller
    // for the "how does this compare" audit trail) but is NOT what gets
    // persisted onto the reservation.
    expect(result.quote?.grandTotal).toBe(10000)
    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 45000, finalRoomRate: 50000, proposalId: 'prop-abc' })
    )
    expect(activityInserts[0]).toMatchObject({
      metadata: expect.objectContaining({ pricingSource: 'proposal', finalRoomRate: 50000 }),
    })
  })

  // Production fix — proposals.reservation_id link-back. Root cause: the
  // accepted-proposal -> reservation flow only ever set
  // reservations.proposal_id, never the reverse FK. Invoice/Receipt/etc.
  // still worked via commercial-source.ts's reverse lookup, but any other
  // consumer querying proposals.reservation_id directly saw NULL forever.
  it('links proposals.reservation_id back to the new reservation when proposalId is set', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 50000, base_price: 45000 }, error: null })

    const result = await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-abc' })

    expect(result.reservationResult.ok).toBe(true)
    expect(result.proposalLinkError).toBeUndefined()
    expect(proposalUpdates).toEqual([{ id: 'prop-abc', patch: { reservation_id: 'res-1' } }])
  })

  it('never touches proposals when the reservation is a walk-in (no proposalId)', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    const result = await createReservationWithQuote({ ...baseInput, customerId: 'lead-1' })

    expect(result.proposalLinkError).toBeUndefined()
    expect(proposalUpdates).toEqual([])
  })

  it('surfaces a failed link-back via proposalLinkError WITHOUT failing the reservation itself (no retry -> no duplicate reservation)', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 50000, base_price: 45000 }, error: null })
    mocks.proposalLinkUpdate.mockReturnValue({ error: { message: 'constraint violation' } })

    const result = await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-abc' })

    expect(result.reservationResult.ok).toBe(true) // reservation still succeeded
    // Enriched error handling — the message is self-describing (contains
    // both ids) rather than a bare DB error, so it's identifiable wherever
    // it ends up (log line, API response, stored field) without needing the
    // structured metadata alongside it.
    expect(result.proposalLinkError).toBe('Failed to link proposal to reservation (proposalId=prop-abc reservationId=res-1): constraint violation')
  })

  it('does not attempt the link-back when reservation creation itself failed', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: false, error: 'db_error', message: 'insert failed' })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 50000, base_price: 45000 }, error: null })

    const result = await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-abc' })

    expect(result.reservationResult.ok).toBe(false)
    expect(result.proposalLinkError).toBeUndefined()
    expect(proposalUpdates).toEqual([])
  })

  // Internal-consistency fix (Reservation -> Invoice architecture pass,
  // Option A) — the exact seam the reported bug lived in: a reservation
  // converted from an accepted proposal, where the operator ALSO picks a
  // meal plan the original proposal never knew about. finalRoomRate must
  // count both the proposal's already-accepted total AND the newly-selected
  // meal plan charge — never silently drop either. (Add-on pricing is
  // exercised by the pre-existing 'persists the quoted room rate and meal
  // plan charge...' test above; this file's property-service mock only
  // stubs getMealPlanById, not getAddonServicesByIds, so add-ons aren't
  // exercised in this particular test.)
  it('Flow B + a new meal plan chosen in the reservation form: finalRoomRate adds it on top of the proposal total, not in place of it', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 50000, base_price: 45000 }, error: null })
    mocks.getMealPlanById.mockResolvedValue({ id: 'mp-1', propertyId: 'prop-1', code: 'breakfast', name: 'Breakfast', description: null, price: 500, isActive: true })

    const result = await createReservationWithQuote({
      ...baseInput,
      customerId: 'lead-1',
      proposalId: 'prop-abc',
      mealPlanId: 'mp-1',
    })

    expect(result.reservationResult.ok).toBe(true)
    // 50000 (proposal's already-accepted total) + 1000 (500 x 2 nights meal
    // plan) = 51000. Before this fix, finalRoomRate would have been hard-set
    // to 50000, silently dropping the meal plan charge even though
    // meal_plan_charge (1000) was correctly persisted right next to it.
    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 45000, finalRoomRate: 51000, mealPlanCharge: 1000, discountAmount: 0 })
    )
  })

  it('does NOT inherit pricing from a proposal that is not yet accepted (e.g. "sent") — falls back to the rate_plans quote', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'sent', total_price: 50000, base_price: 45000 }, error: null })

    await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-abc' })

    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 10000, finalRoomRate: 10000 })
    )
    expect(activityInserts[0]).toMatchObject({ metadata: expect.objectContaining({ pricingSource: 'rate_plan' }) })
  })

  it('does NOT inherit pricing from an accepted proposal whose total_price is 0 (never trust a zero override) — falls back to the rate_plans quote', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 0, base_price: 0 }, error: null })

    await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-abc' })

    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 10000, finalRoomRate: 10000 })
    )
    expect(activityInserts[0]).toMatchObject({ metadata: expect.objectContaining({ pricingSource: 'rate_plan' }) })
  })

  it('does NOT inherit pricing when the linked proposal cannot be found — falls back to the rate_plans quote', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })
    mocks.proposalLookup.mockReturnValue({ data: null, error: null })

    await createReservationWithQuote({ ...baseInput, customerId: 'lead-1', proposalId: 'prop-does-not-exist' })

    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 10000, finalRoomRate: 10000 })
    )
    expect(activityInserts[0]).toMatchObject({ metadata: expect.objectContaining({ pricingSource: 'rate_plan' }) })
  })

  it('falls back to proposal.total_price for baseRoomRate when base_price is 0/absent', async () => {
    mocks.checkAvailability.mockResolvedValue({ available: true, conflictingReservationIds: [] })
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-1' } })
    mocks.proposalLookup.mockReturnValue({ data: { status: 'accepted', total_price: 42000, base_price: 0 }, error: null })

    await createReservationWithQuote({ ...baseInput, proposalId: 'prop-abc' })

    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ baseRoomRate: 42000, finalRoomRate: 42000 })
    )
  })
})

describe('createManualBlock (Sprint 1, Priority 1 — manual availability override)', () => {
  beforeEach(() => {
    mocks.createReservation.mockReset()
    mocks.getInventoryItemRate.mockReset()
    activityInserts.length = 0
  })

  it('calls createReservation() directly -- no pricing/quote step -- with a clearly-tagged guest name and bookingSource "other"', async () => {
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-block-1' } })

    const result = await createManualBlock({
      propertyId: 'prop-1',
      inventoryItemId: 'item-1',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-03',
      reason: 'Maintenance — AC repair',
    })

    expect(result).toEqual({ ok: true, reservation: { id: 'res-block-1' } })
    expect(mocks.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        guestName: 'BLOCKED — Maintenance — AC repair',
        propertyId: 'prop-1',
        inventoryItemId: 'item-1',
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-03',
        roomCount: 1,
        bookingSource: 'other',
        baseRoomRate: 0,
        finalRoomRate: 0,
      })
    )
    // No pricing lookup, unlike createReservationWithQuote.
    expect(mocks.getInventoryItemRate).not.toHaveBeenCalled()
  })

  it('includes createdBy in specialRequests when provided, without changing any other field', async () => {
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-block-2' } })

    await createManualBlock({
      propertyId: 'prop-1',
      inventoryItemId: 'item-1',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-03',
      reason: 'Owner personal use',
      createdBy: 'raju',
    })

    const call = mocks.createReservation.mock.calls[0][0]
    expect(call.specialRequests).toContain('Owner personal use')
    expect(call.specialRequests).toContain('blocked by raju')
  })

  it('propagates an "unavailable" result unchanged when the dates are already taken (createReservation\'s own availability check still applies)', async () => {
    mocks.createReservation.mockResolvedValue({ ok: false, error: 'unavailable', conflictingReservationIds: ['res-existing'] })

    const result = await createManualBlock({
      propertyId: 'prop-1',
      inventoryItemId: 'item-1',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-03',
      reason: 'Maintenance',
    })

    expect(result).toEqual({ ok: false, error: 'unavailable', conflictingReservationIds: ['res-existing'] })
  })

  it('never writes to activity_logs (would silently no-op without a leadId anyway -- the reservation row is the audit trail)', async () => {
    mocks.createReservation.mockResolvedValue({ ok: true, reservation: { id: 'res-block-3' } })

    await createManualBlock({
      propertyId: 'prop-1',
      inventoryItemId: 'item-1',
      checkInDate: '2026-09-01',
      checkOutDate: '2026-09-03',
      reason: 'Maintenance',
    })

    expect(activityInserts).toHaveLength(0)
  })
})

describe('confirmReservation / cancelReservation', () => {
  beforeEach(() => {
    mocks.transitionReservationStatus.mockReset()
    activityInserts.length = 0
  })

  it('confirmReservation transitions to confirmed and logs activity', async () => {
    mocks.transitionReservationStatus.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    const result = await confirmReservation('res-1')

    expect(mocks.transitionReservationStatus).toHaveBeenCalledWith('res-1', 'confirmed')
    expect(result.ok).toBe(true)
    expect(activityInserts[0]).toMatchObject({ action: 'reservation_confirmed', lead_id: 'lead-1' })
  })

  it('cancelReservation transitions to cancelled with a reason and logs activity', async () => {
    mocks.transitionReservationStatus.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    const result = await cancelReservation('res-1', 'Customer changed plans')

    expect(mocks.transitionReservationStatus).toHaveBeenCalledWith('res-1', 'cancelled')
    expect(result.ok).toBe(true)
    expect(activityInserts[0]).toMatchObject({ action: 'reservation_cancelled', description: 'Customer changed plans' })
  })

  it('does not log activity when the transition is invalid', async () => {
    mocks.transitionReservationStatus.mockResolvedValue({ ok: false, error: 'invalid_transition', from: 'checked_out', to: 'confirmed' })

    const result = await confirmReservation('res-1')

    expect(result.ok).toBe(false)
    expect(activityInserts).toHaveLength(0)
  })
})

describe('checkInReservation / checkOutReservation', () => {
  beforeEach(() => {
    mocks.transitionReservationStatus.mockReset()
    activityInserts.length = 0
  })

  it('checkInReservation transitions to checked_in and logs activity', async () => {
    mocks.transitionReservationStatus.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    const result = await checkInReservation('res-1')

    expect(mocks.transitionReservationStatus).toHaveBeenCalledWith('res-1', 'checked_in')
    expect(result.ok).toBe(true)
    expect(activityInserts[0]).toMatchObject({ action: 'reservation_checked_in', lead_id: 'lead-1' })
  })

  it('checkOutReservation transitions to checked_out and logs activity', async () => {
    mocks.transitionReservationStatus.mockResolvedValue({ ok: true, reservation: { id: 'res-1', customerId: 'lead-1' } })

    const result = await checkOutReservation('res-1')

    expect(mocks.transitionReservationStatus).toHaveBeenCalledWith('res-1', 'checked_out')
    expect(result.ok).toBe(true)
    expect(activityInserts[0]).toMatchObject({ action: 'reservation_checked_out', lead_id: 'lead-1' })
  })

  it('does not log activity when a check-in/out transition is invalid', async () => {
    mocks.transitionReservationStatus.mockResolvedValue({ ok: false, error: 'invalid_transition', from: 'inquiry', to: 'checked_in' })

    const result = await checkInReservation('res-1')

    expect(result.ok).toBe(false)
    expect(activityInserts).toHaveLength(0)
  })
})
