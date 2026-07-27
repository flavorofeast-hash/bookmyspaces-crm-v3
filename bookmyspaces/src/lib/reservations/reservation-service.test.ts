import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  existingReservations: [] as Array<{ id: string; check_in_date: string; check_out_date: string }>,
  insertedRow: null as Record<string, unknown> | null,
  insertError: null as { message: string } | null,
  currentStatus: 'inquiry' as string | null,
  updatedRow: null as Record<string, unknown> | null,
  updateError: null as { message: string } | null,
  joinedRows: [] as Array<Record<string, unknown>>,
  joinedSingleRow: null as Record<string, unknown> | null,
  // Add-on Services booking-flow integration (Reservation Platform activation, Phase 4).
  insertedAddonRows: null as Record<string, unknown>[] | null,
}

/** A chainable query-builder stub: every filter method returns `this` so any
 * combination the real code calls (`.in()`, `.eq()`, `.gte()`, `.lte()`,
 * `.order()`, `.limit()`) works, and it resolves (is `then`-able) to the
 * configured joined rows — mirroring how supabase-js's real builder behaves. */
function makeJoinedListBuilder() {
  const builder: any = {
    in: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: state.joinedSingleRow, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: state.joinedRows, error: null }),
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      // Add-on Services booking-flow integration (Reservation Platform
      // activation, Phase 4): createReservation() writes reservation_addons
      // as a second, best-effort insert after the reservations row exists.
      if (table === 'reservation_addons') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            state.insertedAddonRows = rows
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table !== 'reservations') throw new Error(`unexpected table: ${table}`)
      return {
        select: (cols: string) => {
          // listReservations/getReservationById: select('*, properties(name), inventory_items(...)')
          if (cols.includes('properties(name)')) {
            return makeJoinedListBuilder()
          }
          // availability check path: select(...).eq(...).in(...).lt(...).gt(...)
          if (cols.includes('check_in_date') && cols.includes('check_out_date') && !cols.includes('status')) {
            return { eq: () => ({ in: () => ({ lt: () => ({ gt: () => Promise.resolve({ data: state.existingReservations, error: null }) }) }) }) }
          }
          // transitionReservationStatus's status lookup: select('status').eq(...).maybeSingle()
          if (cols === 'status') {
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.currentStatus ? { status: state.currentStatus } : null, error: null }) }) }
          }
          throw new Error(`unexpected select: ${cols}`)
        },
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: state.insertedRow, error: state.insertError }),
          }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: state.updatedRow, error: state.updateError }),
            }),
          }),
        }),
      }
    },
  }),
}))

import { createReservation, transitionReservationStatus, listReservations, getReservationById } from './reservation-service'

const baseInput = {
  guestName: 'Priya Sharma',
  propertyId: 'prop-1',
  inventoryItemId: 'item-1',
  checkInDate: '2026-08-01',
  checkOutDate: '2026-08-05',
}

const baseRow = {
  id: 'res-1', customer_id: null, guest_name: 'Priya Sharma', guest_mobile: null, guest_email: null,
  guest_address: null, guest_id_proof: null, guest_nationality: null, property_id: 'prop-1',
  inventory_item_id: 'item-1', room_count: 1, check_in_date: '2026-08-01', check_out_date: '2026-08-05',
  nights: 4, adults: 1, children: 0, booking_source: 'direct', status: 'inquiry',
  base_room_rate: 0, discount_amount: 0, final_room_rate: 0, meal_plan_id: null, meal_plan_charge: 0,
  special_requests: null, proposal_id: null, invoice_id: null,
}

describe('createReservation', () => {
  beforeEach(() => {
    state.existingReservations = []
    state.insertedRow = null
    state.insertError = null
    state.insertedAddonRows = null
  })

  it('refuses to create a reservation when the inventory item is unavailable', async () => {
    state.existingReservations = [{ id: 'existing-res', check_in_date: '2026-08-02', check_out_date: '2026-08-06' }]

    const result = await createReservation(baseInput)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('unavailable')
      if (result.error === 'unavailable') expect(result.conflictingReservationIds).toEqual(['existing-res'])
    }
  })

  it('creates the reservation in inquiry status when the item is available', async () => {
    state.insertedRow = baseRow

    const result = await createReservation(baseInput)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.reservation.status).toBe('inquiry')
      expect(result.reservation.guestName).toBe('Priya Sharma')
    }
  })

  it('surfaces a db_error result when the insert fails', async () => {
    state.insertError = { message: 'constraint violation' }

    const result = await createReservation(baseInput)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('db_error')
  })

  it('carries proposalId onto the reservation when converting a proposal (Sprint 3)', async () => {
    state.insertedRow = { ...baseRow, proposal_id: 'proposal-1' }

    const result = await createReservation({ ...baseInput, proposalId: 'proposal-1' })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reservation.proposalId).toBe('proposal-1')
  })

  // Add-on Services booking-flow integration (Reservation Platform activation, Phase 4).
  it('writes one reservation_addons row per priced line, tagged with the new reservation id', async () => {
    state.insertedRow = baseRow // id: 'res-1'

    const result = await createReservation({
      ...baseInput,
      addonLines: [
        { addonServiceId: 'addon-1', name: 'Extra Bed', quantity: 2, unitPrice: 500, totalPrice: 1000 },
        { addonServiceId: 'addon-2', name: 'Airport Pickup', quantity: 1, unitPrice: 800, totalPrice: 800 },
      ],
    })

    expect(result.ok).toBe(true)
    expect(state.insertedAddonRows).toEqual([
      { reservation_id: 'res-1', addon_service_id: 'addon-1', quantity: 2, unit_price: 500, total_price: 1000 },
      { reservation_id: 'res-1', addon_service_id: 'addon-2', quantity: 1, unit_price: 800, total_price: 800 },
    ])
  })

  it('does not touch reservation_addons at all when no add-ons were selected', async () => {
    state.insertedRow = baseRow

    await createReservation(baseInput)

    expect(state.insertedAddonRows).toBeNull()
  })
})

describe('transitionReservationStatus', () => {
  beforeEach(() => {
    state.currentStatus = 'inquiry'
    state.updatedRow = null
    state.updateError = null
  })

  it('allows inquiry -> confirmed and returns the updated reservation', async () => {
    state.updatedRow = { ...baseRow, status: 'confirmed' }

    const result = await transitionReservationStatus('res-1', 'confirmed')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.reservation.status).toBe('confirmed')
  })

  it('rejects an invalid transition without touching the database', async () => {
    state.currentStatus = 'checked_out'

    const result = await transitionReservationStatus('res-1', 'confirmed')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalid_transition')
      if (result.error === 'invalid_transition') {
        expect(result.from).toBe('checked_out')
        expect(result.to).toBe('confirmed')
      }
    }
  })

  it('returns not_found when the reservation does not exist', async () => {
    state.currentStatus = null

    const result = await transitionReservationStatus('missing-id', 'confirmed')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found')
  })
})

describe('listReservations', () => {
  beforeEach(() => { state.joinedRows = [] })

  it('maps joined property/inventory names onto each reservation', async () => {
    state.joinedRows = [{
      ...baseRow,
      properties: { name: 'Skyline Serenity' },
      inventory_items: { name: 'Deluxe Room 101', inventory_type: 'room' },
    }]

    const result = await listReservations()

    expect(result).toHaveLength(1)
    expect(result[0].propertyName).toBe('Skyline Serenity')
    expect(result[0].inventoryName).toBe('Deluxe Room 101')
    expect(result[0].inventoryType).toBe('room')
    expect(result[0].guestName).toBe('Priya Sharma')
  })

  it('falls back gracefully when a join is missing', async () => {
    state.joinedRows = [{ ...baseRow, properties: null, inventory_items: null }]

    const result = await listReservations()

    expect(result[0].propertyName).toBe('Unknown property')
    expect(result[0].inventoryName).toBe('Unknown inventory')
    expect(result[0].inventoryType).toBeNull()
  })

  it('returns an empty array when there are no reservations', async () => {
    expect(await listReservations()).toEqual([])
  })
})

describe('getReservationById', () => {
  beforeEach(() => { state.joinedSingleRow = null })

  it('returns the joined reservation when found', async () => {
    state.joinedSingleRow = {
      ...baseRow,
      properties: { name: 'Skyline Serenity' },
      inventory_items: { name: 'Deluxe Room 101', inventory_type: 'room' },
    }

    const result = await getReservationById('res-1')

    expect(result?.propertyName).toBe('Skyline Serenity')
    expect(result?.id).toBe('res-1')
  })

  it('returns null when not found', async () => {
    expect(await getReservationById('missing-id')).toBeNull()
  })
})
