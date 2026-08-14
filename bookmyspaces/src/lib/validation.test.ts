// src/lib/validation.test.ts
// ISS-005 follow-up: unit tests for the new zod schemas. These are pure
// functions with no Supabase/network dependency, so — unlike almost
// everything else touched this session — they can actually be exercised in
// this sandbox instead of only statically type-checked.

import { describe, it, expect } from 'vitest'
import { createLeadSchema, updateLeadSchema, leadStageBodySchema, createManualBlockSchema, createReservationSchema } from './validation'

describe('createLeadSchema', () => {
  it('accepts a minimal valid lead', () => {
    const result = createLeadSchema.safeParse({ name: 'Test Lead', phone: '9876543210' })
    expect(result.success).toBe(true)
  })

  it('accepts an empty object (every field optional, matches prior behavior)', () => {
    const result = createLeadSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = createLeadSchema.safeParse({ email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('accepts guest_count as a numeric string (matches existing frontend behavior)', () => {
    const result = createLeadSchema.safeParse({ guest_count: '150' })
    expect(result.success).toBe(true)
  })

  it('rejects a non-numeric guest_count', () => {
    const result = createLeadSchema.safeParse({ guest_count: 'a lot of people' })
    expect(result.success).toBe(false)
  })
})

describe('updateLeadSchema', () => {
  it('requires id', () => {
    const result = updateLeadSchema.safeParse({ name: 'New Name' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed (non-UUID) id', () => {
    const result = updateLeadSchema.safeParse({ id: 'not-a-uuid', name: 'New Name' })
    expect(result.success).toBe(false)
  })

  it('accepts id + one allow-listed field', () => {
    const result = updateLeadSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', status: 'confirmed' })
    expect(result.success).toBe(true)
  })

  it('rejects mass-assignment of a non-allow-listed field (e.g. ai_score)', () => {
    const result = updateLeadSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', ai_score: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects an attempt to smuggle lead_stage through the generic PATCH (has its own validated endpoint)', () => {
    const result = updateLeadSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', lead_stage: 'CONFIRMED' })
    expect(result.success).toBe(false)
  })
})

describe('leadStageBodySchema', () => {
  it('accepts a valid stage', () => {
    const result = leadStageBodySchema.safeParse({ stage: 'QUALIFIED' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid/unknown stage', () => {
    const result = leadStageBodySchema.safeParse({ stage: 'MADE_UP_STAGE' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing stage', () => {
    const result = leadStageBodySchema.safeParse({ reason: 'no stage provided' })
    expect(result.success).toBe(false)
  })
})

describe('createManualBlockSchema (Sprint 1, Priority 1 — manual availability override)', () => {
  const valid = {
    propertyId: '11111111-1111-1111-1111-111111111111',
    inventoryItemId: '22222222-2222-2222-2222-222222222222',
    checkInDate: '2026-09-01',
    checkOutDate: '2026-09-03',
    reason: 'Maintenance',
  }

  it('accepts a valid manual block request', () => {
    const result = createManualBlockSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('rejects a missing reason (a block must always be self-explanatory)', () => {
    const { reason, ...withoutReason } = valid
    const result = createManualBlockSchema.safeParse(withoutReason)
    expect(result.success).toBe(false)
  })

  it('rejects an empty-string reason', () => {
    const result = createManualBlockSchema.safeParse({ ...valid, reason: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-UUID inventoryItemId', () => {
    const result = createManualBlockSchema.safeParse({ ...valid, inventoryItemId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed date', () => {
    const result = createManualBlockSchema.safeParse({ ...valid, checkInDate: '09/01/2026' })
    expect(result.success).toBe(false)
  })

  it('has no guest/pricing fields -- unlike createReservationSchema, none are expected or accepted here', () => {
    const result = createManualBlockSchema.safeParse({ ...valid, guestName: 'Should not matter' })
    // Not .strict(), so an extra unknown field is just ignored by zod's default
    // behavior -- the important guarantee is that omitting guestName/pricing
    // fields entirely (as `valid` does) still passes, proving they're not required.
    expect(result.success).toBe(true)
  })

  // FIX (repo-wide audit finding): checkOutDate <= checkInDate used to reach
  // createManualBlock() unvalidated -- caught here now instead of downstream.
  it('rejects checkOutDate equal to checkInDate', () => {
    const result = createManualBlockSchema.safeParse({ ...valid, checkOutDate: valid.checkInDate })
    expect(result.success).toBe(false)
  })

  it('rejects checkOutDate before checkInDate', () => {
    const result = createManualBlockSchema.safeParse({ ...valid, checkInDate: '2026-09-05', checkOutDate: '2026-09-01' })
    expect(result.success).toBe(false)
  })
})

describe('createReservationSchema (date-order validation)', () => {
  const valid = {
    guestName: 'Test Guest',
    propertyId: '11111111-1111-1111-1111-111111111111',
    inventoryItemId: '22222222-2222-2222-2222-222222222222',
    checkInDate: '2026-09-01',
    checkOutDate: '2026-09-03',
  }

  it('accepts a valid check-in/check-out range', () => {
    const result = createReservationSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  // FIX (repo-wide audit finding): a reversed/zero-night range used to reach
  // createReservationWithQuote() unvalidated, producing a zero-price,
  // zero-night reservation instead of a 400.
  it('rejects checkOutDate equal to checkInDate', () => {
    const result = createReservationSchema.safeParse({ ...valid, checkOutDate: valid.checkInDate })
    expect(result.success).toBe(false)
  })

  it('rejects checkOutDate before checkInDate', () => {
    const result = createReservationSchema.safeParse({ ...valid, checkInDate: '2026-09-05', checkOutDate: '2026-09-01' })
    expect(result.success).toBe(false)
  })
})
