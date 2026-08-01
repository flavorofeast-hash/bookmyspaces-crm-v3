import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResolved = {
  value: null as { leadId: string; name: string | null; phone: string | null; email: string | null; matchedOn: 'phone' | 'email'; hasConflictingIdentifier: boolean } | null,
}

vi.mock('@/lib/identity/resolve-identity', () => ({
  resolveIdentity: vi.fn(() => Promise.resolve(mockResolved.value)),
}))

const state = {
  leadInsertResult: null as Record<string, unknown> | null,
  leadInsertError: null as { message: string } | null,
  visitInsertResult: null as Record<string, unknown> | null,
  visitInsertError: null as { message: string } | null,
  lastLeadInsertPayload: null as Record<string, unknown> | null,
  lastVisitInsertPayload: null as Record<string, unknown> | null,
  selectResult: null as unknown[] | null,
  selectError: null as { message: string } | null,
  updateResult: { error: null as { message: string } | null },
}

function resetState() {
  state.leadInsertResult = null
  state.leadInsertError = null
  state.visitInsertResult = null
  state.visitInsertError = null
  state.lastLeadInsertPayload = null
  state.lastVisitInsertPayload = null
  state.selectResult = null
  state.selectError = null
  state.updateResult = { error: null }
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'leads') {
        return {
          insert: (payload: Record<string, unknown>) => {
            state.lastLeadInsertPayload = payload
            return {
              select: () => ({
                single: () => Promise.resolve({ data: state.leadInsertResult, error: state.leadInsertError }),
              }),
            }
          },
        }
      }
      if (table === 'follow_ups') {
        return {
          insert: (payload: Record<string, unknown>) => {
            state.lastVisitInsertPayload = payload
            return {
              select: () => ({
                single: () => Promise.resolve({ data: state.visitInsertResult, error: state.visitInsertError }),
              }),
            }
          },
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: () => ({
                  order: () => Promise.resolve({ data: state.selectResult, error: state.selectError }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve(state.updateResult),
            }),
          }),
        }
      }
      // activity_logs and anything else — accept and no-op
      return { insert: () => Promise.resolve({ data: null, error: null }) }
    },
  }),
}))

import {
  scheduleSiteVisit,
  listSiteVisitsForDate,
  updateSiteVisitStatus,
  siteVisitStatusLabel,
} from './site-visit-service'
import { resolveIdentity } from '@/lib/identity/resolve-identity'

describe('scheduleSiteVisit', () => {
  beforeEach(() => {
    resetState()
    mockResolved.value = null
    vi.mocked(resolveIdentity).mockClear()
  })

  it('reuses an existing lead when resolveIdentity finds a match, never inserting a new lead', async () => {
    mockResolved.value = {
      leadId: 'existing-1', name: 'Priya', phone: '919830509991', email: null,
      matchedOn: 'phone', hasConflictingIdentifier: false,
    }
    state.visitInsertResult = { id: 'visit-1' }

    const result = await scheduleSiteVisit({
      name: 'Priya Sharma', phone: '9830509991', property: 'Monurama Homestay',
      visitDate: '2026-08-10', visitTime: '15:00',
    })

    expect(result).toEqual({ visitId: 'visit-1', leadId: 'existing-1', leadCreated: false, scheduledAt: expect.any(String) })
    expect(state.lastLeadInsertPayload).toBeNull()
    expect(state.lastVisitInsertPayload).toMatchObject({
      lead_id: 'existing-1', type: 'site_visit', status: 'pending', property: 'Monurama Homestay',
    })
  })

  it('creates a new lead with source "other" when no match is found', async () => {
    mockResolved.value = null
    state.leadInsertResult = { id: 'new-lead-1' }
    state.visitInsertResult = { id: 'visit-2' }

    const result = await scheduleSiteVisit({
      name: 'Amit Roy', phone: '9051459463', property: 'Monurama Homestay',
      visitDate: '2026-08-11', visitTime: '11:30', guestCount: 45, budget: '1.5-2L',
      purpose: 'Wedding site visit — Rooftop',
    })

    expect(result).toEqual({ visitId: 'visit-2', leadId: 'new-lead-1', leadCreated: true, scheduledAt: expect.any(String) })
    expect(state.lastLeadInsertPayload).toMatchObject({
      name: 'Amit Roy', source: 'other', status: 'new_inquiry', guest_count: 45, budget: '1.5-2L',
    })
    expect(state.lastVisitInsertPayload).toMatchObject({
      guest_count: 45, budget: '1.5-2L', purpose: 'Wedding site visit — Rooftop',
    })
  })

  it('uses the provided lead_id directly without calling resolveIdentity', async () => {
    state.visitInsertResult = { id: 'visit-3' }

    const result = await scheduleSiteVisit({
      leadId: 'lead-provided', name: 'Sneha', property: 'Skyline Serenity',
      visitDate: '2026-08-12', visitTime: '10:00',
    })

    expect(resolveIdentity).not.toHaveBeenCalled()
    expect(result?.leadId).toBe('lead-provided')
    expect(result?.leadCreated).toBe(false)
  })

  it('returns null (does not throw) when the lead insert fails', async () => {
    mockResolved.value = null
    state.leadInsertError = { message: 'insert denied' }

    const result = await scheduleSiteVisit({
      name: 'Sneha', phone: '9051459463', property: 'Monurama Homestay',
      visitDate: '2026-08-13', visitTime: '09:00',
    })

    expect(result).toBeNull()
  })

  it('returns null (does not throw) when the visit insert fails', async () => {
    mockResolved.value = {
      leadId: 'existing-2', name: 'Rajib', phone: '919830509991', email: null,
      matchedOn: 'phone', hasConflictingIdentifier: false,
    }
    state.visitInsertError = { message: 'constraint violation' }

    const result = await scheduleSiteVisit({
      name: 'Rajib', phone: '9830509991', property: 'Monurama Homestay',
      visitDate: '2026-08-14', visitTime: '14:00',
    })

    expect(result).toBeNull()
  })
})

describe('listSiteVisitsForDate', () => {
  beforeEach(resetState)

  it('maps joined lead fields onto each visit row', async () => {
    state.selectResult = [
      {
        id: 'visit-1', scheduled_at: '2026-08-10T09:30:00+05:30', property: 'Monurama Homestay',
        purpose: 'Wedding visit', guest_count: 45, budget: '1.5-2L', status: 'pending', lead_id: 'lead-1',
        leads: { name: 'Priya Sharma', phone: '919830509991' },
      },
    ]

    const result = await listSiteVisitsForDate('2026-08-10')

    expect(result).toEqual([{
      id: 'visit-1', scheduledAt: '2026-08-10T09:30:00+05:30', customerName: 'Priya Sharma',
      customerPhone: '919830509991', property: 'Monurama Homestay', purpose: 'Wedding visit',
      guestCount: 45, budget: '1.5-2L', status: 'pending', leadId: 'lead-1',
    }])
  })

  it('returns an empty array on query error rather than throwing', async () => {
    state.selectError = { message: 'db down' }
    const result = await listSiteVisitsForDate('2026-08-10')
    expect(result).toEqual([])
  })
})

describe('updateSiteVisitStatus', () => {
  beforeEach(resetState)

  it('returns true on success', async () => {
    state.updateResult = { error: null }
    const ok = await updateSiteVisitStatus('visit-1', 'completed')
    expect(ok).toBe(true)
  })

  it('returns false on error', async () => {
    state.updateResult = { error: { message: 'not found' } }
    const ok = await updateSiteVisitStatus('visit-1', 'completed')
    expect(ok).toBe(false)
  })
})

describe('siteVisitStatusLabel', () => {
  it('maps known statuses to display labels', () => {
    expect(siteVisitStatusLabel('pending')).toBe('Scheduled')
    expect(siteVisitStatusLabel('completed')).toBe('Completed')
    expect(siteVisitStatusLabel('skipped')).toBe('No-show')
    expect(siteVisitStatusLabel('rescheduled')).toBe('Rescheduled')
  })

  it('falls back to the raw value for an unknown status', () => {
    expect(siteVisitStatusLabel('weird')).toBe('weird')
  })
})
