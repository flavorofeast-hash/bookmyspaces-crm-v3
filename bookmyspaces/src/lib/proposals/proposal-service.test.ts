import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  calculatePrice: vi.fn(),
}))

vi.mock('@/lib/reservations/reservation-workflow', () => ({
  calculatePrice: mocks.calculatePrice,
}))

const mockResolved = {
  value: null as { leadId: string; name: string | null; phone: string | null; email: string | null; matchedOn: 'phone' | 'email'; hasConflictingIdentifier: boolean } | null,
}

vi.mock('@/lib/identity/resolve-identity', () => ({
  resolveIdentity: vi.fn(() => Promise.resolve(mockResolved.value)),
}))

const state = {
  updateResult: null as Record<string, unknown> | null,
  updateError: null as { message: string } | null,
  insertResult: null as Record<string, unknown> | null,
  insertError: null as { message: string } | null,
  lastInsertPayload: null as Record<string, unknown> | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: state.updateResult, error: state.updateError }),
          }),
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        state.lastInsertPayload = payload
        return {
          select: () => ({
            single: () => Promise.resolve({ data: state.insertResult, error: state.insertError }),
          }),
        }
      },
    }),
  }),
}))

import { linkProposalToReservation, createProposalFromReservation, ensureLeadForProposal } from './proposal-service'
import { resolveIdentity } from '@/lib/identity/resolve-identity'

function resetState() {
  state.updateResult = null
  state.updateError = null
  state.insertResult = null
  state.insertError = null
  state.lastInsertPayload = null
}

describe('linkProposalToReservation', () => {
  beforeEach(resetState)

  it('links a proposal to reservation/property/inventory/package/addons', async () => {
    state.updateResult = { id: 'prop-1' }

    const result = await linkProposalToReservation('prop-1', {
      propertyId: 'prop-loc-1',
      inventoryItemId: 'item-1',
      reservationId: 'res-1',
      packageId: 'pkg-1',
      addonServiceIds: ['addon-1', 'addon-2'],
    })

    expect(result).toEqual({ ok: true, proposalId: 'prop-1' })
  })

  it('returns not_found when the proposal id does not exist', async () => {
    state.updateResult = null
    const result = await linkProposalToReservation('missing', {})
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('propagates a db error', async () => {
    state.updateError = { message: 'constraint violation' }
    const result = await linkProposalToReservation('prop-1', {})
    expect(result).toEqual({ ok: false, error: 'db_error', message: 'constraint violation' })
  })
})

describe('createProposalFromReservation', () => {
  beforeEach(() => {
    resetState()
    mocks.calculatePrice.mockReset()
  })

  const baseInput = {
    reservationId: 'res-1',
    leadId: 'lead-1',
    clientName: 'Priya Sharma',
    clientPhone: '919051459463',
    clientEmail: 'priya@example.com',
    propertyId: 'prop-loc-1',
    inventoryItemId: 'item-1',
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-03',
    guestCount: 80,
    packageName: 'Gold',
  }

  it('prices via the Pricing Engine, includes addons, and links the reservation', async () => {
    mocks.calculatePrice.mockResolvedValue({ subtotal: 100000, isComplete: true, nights: 2, nightlyRates: [50000, 50000], pricedNights: 2, unpricedNights: 0, roomCount: 1, inventoryItemId: 'item-1', checkInDate: '2026-08-01', checkOutDate: '2026-08-03' })
    state.insertResult = { id: 'proposal-1', proposal_number: 'BMS-2026-002' }

    const result = await createProposalFromReservation({
      ...baseInput,
      addons: [{ name: 'DJ', price: 15000 }],
    })

    expect(result).toEqual({ ok: true, proposalId: 'proposal-1', proposalNumber: 'BMS-2026-002', totalPrice: 115000 })
    expect(state.lastInsertPayload).toMatchObject({
      lead_id: 'lead-1',
      reservation_id: 'res-1',
      property_id: 'prop-loc-1',
      inventory_item_id: 'item-1',
      base_price: 100000,
      total_price: 115000,
      status: 'draft',
    })
  })

  it('propagates a db error on insert failure', async () => {
    mocks.calculatePrice.mockResolvedValue({ subtotal: 50000, isComplete: true, nights: 1, nightlyRates: [50000], pricedNights: 1, unpricedNights: 0, roomCount: 1, inventoryItemId: 'item-1', checkInDate: '2026-08-01', checkOutDate: '2026-08-02' })
    state.insertError = { message: 'insert failed' }

    const result = await createProposalFromReservation(baseInput)

    expect(result).toEqual({ ok: false, error: 'db_error', message: 'insert failed' })
  })
})


// ─── ensureLeadForProposal (fix/customer-proposal-sync) ────────────────────
// Uses the same @/lib/supabase mock as the describe blocks above (its
// insert() stub isn't table-scoped, so it fits ensureLeadForProposal's
// insert('leads') call unmodified) plus a dedicated resolveIdentity mock.
// resolveIdentity's own internals are unit-tested separately in
// resolve-identity.test.ts — mocked here at the call boundary, matching
// this project's existing one-layer-down mocking convention.

describe('ensureLeadForProposal', () => {
  beforeEach(() => {
    resetState()
    mockResolved.value = null
    vi.mocked(resolveIdentity).mockClear()
  })

  it('matches an existing lead by phone and does not create a new one', async () => {
    mockResolved.value = {
      leadId: 'existing-1', name: 'Rajib', phone: '919830509991', email: null,
      matchedOn: 'phone', hasConflictingIdentifier: false,
    }

    const result = await ensureLeadForProposal({ name: 'Rajib Chakraborty', phone: '9830509991' })

    expect(result).toEqual({ leadId: 'existing-1', created: false, matchedOn: 'phone' })
    expect(state.lastInsertPayload).toBeNull() // no insert attempted
  })

  it('matches an existing lead by email and does not create a new one', async () => {
    mockResolved.value = {
      leadId: 'existing-2', name: 'Amit', phone: null, email: 'amit@example.com',
      matchedOn: 'email', hasConflictingIdentifier: false,
    }

    const result = await ensureLeadForProposal({ name: 'Amit', email: 'amit@example.com' })

    expect(result).toEqual({ leadId: 'existing-2', created: false, matchedOn: 'email' })
    expect(state.lastInsertPayload).toBeNull()
  })

  it('creates a minimal lead when no phone/email match is found', async () => {
    mockResolved.value = null // no match
    state.insertResult = { id: 'new-lead-1' }

    const result = await ensureLeadForProposal({ name: 'Sneha', phone: '9051459463' })

    expect(result).toEqual({ leadId: 'new-lead-1', created: true, matchedOn: null })
    expect(state.lastInsertPayload).toMatchObject({
      name: 'Sneha',
      phone: '919051459463', // canonicalized by normalizePhone
      email: null,
      source: 'proposal',
      status: 'new_inquiry',
    })
  })

  it('creates a minimal lead from email alone when no phone is given', async () => {
    mockResolved.value = null
    state.insertResult = { id: 'new-lead-2' }

    const result = await ensureLeadForProposal({ name: 'Sneha', email: 'Sneha@Example.com' })

    expect(result?.created).toBe(true)
    expect(state.lastInsertPayload).toMatchObject({ email: 'sneha@example.com', phone: null })
  })

  it('skips identity resolution entirely when neither phone nor email is given, and still creates a name-only lead', async () => {
    state.insertResult = { id: 'new-lead-3' }

    const result = await ensureLeadForProposal({ name: 'Walk-in Customer' })

    expect(resolveIdentity).not.toHaveBeenCalled()
    expect(result?.created).toBe(true)
    expect(state.lastInsertPayload).toMatchObject({ name: 'Walk-in Customer', phone: null, email: null })
  })

  it('fails open (returns null, never throws) when the insert errors', async () => {
    mockResolved.value = null
    state.insertResult = null
    state.insertError = { message: 'insert denied' }

    const result = await ensureLeadForProposal({ name: 'Sneha', phone: '9051459463' })

    expect(result).toBeNull()
  })

  it('fails open when resolveIdentity itself throws', async () => {
    vi.mocked(resolveIdentity).mockRejectedValueOnce(new Error('db down'))

    const result = await ensureLeadForProposal({ name: 'Sneha', phone: '9051459463' })

    expect(result).toBeNull()
  })
})
