import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  visit: null as Record<string, unknown> | null,
  lead: null as Record<string, unknown> | null,
  updatePayload: null as Record<string, unknown> | null,
  updateError: null as { message: string } | null,
}

function resetState() {
  state.visit = null
  state.lead = null
  state.updatePayload = null
  state.updateError = null
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'follow_ups') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: state.visit, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.lead, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            state.updatePayload = payload
            return { eq: () => Promise.resolve({ error: state.updateError }) }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

const runAutoPackageRecommendationMock = vi.fn()
vi.mock('@/lib/leads/auto-package-recommendation', () => ({
  runAutoPackageRecommendation: (...args: unknown[]) => runAutoPackageRecommendationMock(...args),
}))

import { runVisitToProposalConversion } from './visit-to-proposal'

describe('runVisitToProposalConversion', () => {
  beforeEach(() => {
    resetState()
    runAutoPackageRecommendationMock.mockReset()
    runAutoPackageRecommendationMock.mockResolvedValue({ ran: true, packageId: 'pkg-1', draftProposalId: 'proposal-1' })
  })

  it('returns a no-op result when the visit has no linked lead', async () => {
    state.visit = { lead_id: null, property: null, purpose: null, guest_count: null, budget: null }
    const result = await runVisitToProposalConversion('visit-1')
    expect(result).toEqual({ ran: false, packageId: null, draftProposalId: null, leadId: null })
    expect(runAutoPackageRecommendationMock).not.toHaveBeenCalled()
  })

  it('returns a no-op result when the visit row itself is not found', async () => {
    state.visit = null
    const result = await runVisitToProposalConversion('missing-visit')
    expect(result.ran).toBe(false)
    expect(runAutoPackageRecommendationMock).not.toHaveBeenCalled()
  })

  it('calls runAutoPackageRecommendation for the linked lead and forwards its result', async () => {
    state.visit = { lead_id: 'lead-1', property: 'Monurama Homestay', purpose: 'Wedding site visit', guest_count: 60, budget: '2L' }
    state.lead = { guest_count: 60, budget: '2L', venue: 'Monurama Homestay', event_type: 'wedding' }

    const result = await runVisitToProposalConversion('visit-1')

    expect(runAutoPackageRecommendationMock).toHaveBeenCalledWith('lead-1', null)
    expect(result).toEqual({ ran: true, packageId: 'pkg-1', draftProposalId: 'proposal-1', leadId: 'lead-1' })
  })

  it('safe-fills guest_count/budget/venue on the lead only when those fields are null (never overwrites)', async () => {
    state.visit = { lead_id: 'lead-2', property: 'Monurama Homestay', purpose: 'Wedding site visit', guest_count: 80, budget: '3L' }
    state.lead = { guest_count: null, budget: null, venue: null, event_type: 'wedding' }

    await runVisitToProposalConversion('visit-2')

    expect(state.updatePayload).toEqual({ guest_count: 80, budget: '3L', venue: 'Monurama Homestay' })
  })

  it('does not touch the lead when it already has guest_count/budget/venue set', async () => {
    state.visit = { lead_id: 'lead-3', property: 'Skyline Serenity', purpose: 'Site visit', guest_count: 10, budget: '1L' }
    state.lead = { guest_count: 4, budget: '50k', venue: 'Skyline Serenity', event_type: 'wedding' }

    await runVisitToProposalConversion('visit-3')

    expect(state.updatePayload).toBeNull()
  })

  it('does not call runAutoPackageRecommendation when the linked lead itself cannot be found', async () => {
    state.visit = { lead_id: 'lead-4', property: 'Monurama Homestay', purpose: null, guest_count: null, budget: null }
    state.lead = null

    const result = await runVisitToProposalConversion('visit-4')

    expect(result).toEqual({ ran: false, packageId: null, draftProposalId: null, leadId: 'lead-4' })
    expect(runAutoPackageRecommendationMock).not.toHaveBeenCalled()
  })
})
