import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dateRangesOverlap } from './availability-service'

describe('dateRangesOverlap (pure logic, no DB)', () => {
  it('detects a clear overlap', () => {
    expect(dateRangesOverlap('2026-08-01', '2026-08-05', '2026-08-03', '2026-08-07')).toBe(true)
  })

  it('detects no overlap when ranges are fully separate', () => {
    expect(dateRangesOverlap('2026-08-01', '2026-08-05', '2026-08-10', '2026-08-12')).toBe(false)
  })

  it('treats back-to-back ranges (checkout day == checkin day) as NOT overlapping', () => {
    // half-open interval: [Aug 1, Aug 5) and [Aug 5, Aug 8) share a boundary
    // but not a night, so this must be bookable.
    expect(dateRangesOverlap('2026-08-01', '2026-08-05', '2026-08-05', '2026-08-08')).toBe(false)
  })

  it('detects overlap when one range fully contains the other', () => {
    expect(dateRangesOverlap('2026-08-01', '2026-08-10', '2026-08-03', '2026-08-05')).toBe(true)
  })
})

const mockReservationsTable = {
  rows: [] as Array<{ id: string; check_in_date: string; check_out_date: string }>,
  error: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            lt: () => ({
              gt: () =>
                Promise.resolve(
                  mockReservationsTable.error
                    ? { data: null, error: mockReservationsTable.error }
                    : { data: mockReservationsTable.rows, error: null }
                ),
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { checkAvailability } from './availability-service'

describe('checkAvailability', () => {
  beforeEach(() => {
    mockReservationsTable.rows = []
    mockReservationsTable.error = null
  })

  it('reports available when there are no existing reservations for the item', async () => {
    const result = await checkAvailability('item-1', '2026-08-01', '2026-08-05')
    expect(result.available).toBe(true)
    expect(result.status).toBe('available')
    expect(result.conflictingReservationIds).toEqual([])
  })

  it('reports unavailable and lists the conflicting reservation when dates overlap', async () => {
    mockReservationsTable.rows = [{ id: 'res-1', check_in_date: '2026-08-03', check_out_date: '2026-08-07' }]

    const result = await checkAvailability('item-1', '2026-08-01', '2026-08-05')

    expect(result.available).toBe(false)
    expect(result.status).toBe('unavailable')
    expect(result.conflictingReservationIds).toEqual(['res-1'])
  })

  it('reports available for a back-to-back booking (no shared night)', async () => {
    mockReservationsTable.rows = [{ id: 'res-1', check_in_date: '2026-08-01', check_out_date: '2026-08-05' }]

    const result = await checkAvailability('item-1', '2026-08-05', '2026-08-08')

    expect(result.available).toBe(true)
    expect(result.status).toBe('available')
  })

  it('reports status "unknown" (not "unavailable") when the query itself fails', async () => {
    mockReservationsTable.error = { message: 'connection reset' }

    const result = await checkAvailability('item-1', '2026-08-01', '2026-08-05')

    expect(result.status).toBe('unknown')
    expect(result.available).toBe(false) // still fails closed for any caller only reading `.available`
    expect(result.conflictingReservationIds).toEqual([])
  })
})
