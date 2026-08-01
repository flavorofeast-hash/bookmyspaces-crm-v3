import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeOpportunityScore, type OpportunityScoreInput } from './opportunity-score'

function baseInput(overrides: Partial<OpportunityScoreInput> = {}): OpportunityScoreInput {
  return {
    aiScore: 0,
    hasAcceptedProposal: false,
    hasSentProposal: false,
    hasOnlyRejectedProposal: false,
    hasNoProposal: true,
    escalationRequired: false,
    followUpCount: 0,
    clvTotalRevenue: 0,
    isRepeatCustomer: false,
    hasCompletedVisit: false,
    hasViewedProposal: false,
    ...overrides,
  }
}

describe('computeOpportunityScore', () => {
  it('scores a brand-new, untouched lead at the floor of every component', () => {
    const result = computeOpportunityScore(baseInput())
    expect(result.components).toEqual({
      qualification: 0,
      proposalStatus: 6,
      followUpEngagement: 3,
      customerValue: 0,
      repeatCustomerBonus: 0,
      siteVisitEngagement: 0,
      proposalEngagement: 0,
    })
    expect(result.score).toBe(9)
    expect(result.band).toBe('LOW')
  })

  it('never exceeds 100 even when every signal is maxed out', () => {
    const result = computeOpportunityScore(baseInput({
      aiScore: 100,
      hasAcceptedProposal: true,
      escalationRequired: true,
      clvTotalRevenue: 500_000,
      isRepeatCustomer: true,
      hasCompletedVisit: true,
      hasViewedProposal: true,
    }))
    const sum = Object.values(result.components).reduce((a, b) => a + b, 0)
    expect(sum).toBe(100)
    expect(result.score).toBe(100)
    expect(result.band).toBe('HIGH')
  })

  it('awards the Sprint 2 site-visit-engagement component only when a visit is completed', () => {
    const withVisit = computeOpportunityScore(baseInput({ hasCompletedVisit: true }))
    const withoutVisit = computeOpportunityScore(baseInput({ hasCompletedVisit: false }))
    expect(withVisit.components.siteVisitEngagement).toBe(15)
    expect(withoutVisit.components.siteVisitEngagement).toBe(0)
    expect(withVisit.score - withoutVisit.score).toBe(15)
    expect(withVisit.reasoning).toContain('+15/15 completed a site visit — strong buying signal')
  })

  it('awards the Sprint 2 proposal-engagement component only when a proposal has been viewed', () => {
    const withView = computeOpportunityScore(baseInput({ hasViewedProposal: true }))
    const withoutView = computeOpportunityScore(baseInput({ hasViewedProposal: false }))
    expect(withView.components.proposalEngagement).toBe(15)
    expect(withoutView.components.proposalEngagement).toBe(0)
    expect(withView.score - withoutView.score).toBe(15)
  })

  it('a completed visit plus a viewed proposal moves a cold lead into a higher band', () => {
    const cold = computeOpportunityScore(baseInput({ aiScore: 20 }))
    const sameLeadAfterVisitAndView = computeOpportunityScore(baseInput({
      aiScore: 20, hasCompletedVisit: true, hasViewedProposal: true,
    }))
    expect(cold.band).toBe('LOW')
    expect(sameLeadAfterVisitAndView.score).toBe(cold.score + 30)
  })

  it('scales qualification from ai_score out of 30 (not the pre-Sprint-2 40)', () => {
    const result = computeOpportunityScore(baseInput({ aiScore: 50 }))
    expect(result.components.qualification).toBe(15)
  })

  it('proposal status still follows accepted > sent > no-proposal > rejected-only, rescaled to /15', () => {
    expect(computeOpportunityScore(baseInput({ hasAcceptedProposal: true })).components.proposalStatus).toBe(15)
    expect(computeOpportunityScore(baseInput({ hasSentProposal: true })).components.proposalStatus).toBe(9)
    expect(computeOpportunityScore(baseInput({ hasOnlyRejectedProposal: true })).components.proposalStatus).toBe(1)
    expect(computeOpportunityScore(baseInput()).components.proposalStatus).toBe(6)
  })

  it('every returned component key sums to the total score before clamping', () => {
    const input = baseInput({ aiScore: 73, hasSentProposal: true, followUpCount: 2, clvTotalRevenue: 150_000 })
    const result = computeOpportunityScore(input)
    const sum = Object.values(result.components).reduce((a, b) => a + b, 0)
    expect(sum).toBe(result.score)
  })
})

// ── getOpportunityScoreForLead — DB-assembling wrapper ─────────────────────

const state = {
  lead: null as Record<string, unknown> | null,
  proposals: [] as Record<string, unknown>[],
  visitCount: 0,
}

function resetState() {
  state.lead = null
  state.proposals = []
  state.visitCount = 0
}

vi.mock('@/lib/customers/lifetime-value', () => ({
  computeLifetimeValue: vi.fn(() => Promise.resolve({ totalRevenue: 0, isRepeatCustomer: false })),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'leads') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.lead, error: null }) }) }) }
      }
      if (table === 'proposals') {
        return { select: () => ({ eq: () => Promise.resolve({ data: state.proposals, error: null }) }) }
      }
      if (table === 'follow_ups') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ count: state.visitCount, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { getOpportunityScoreForLead } from './opportunity-score'

describe('getOpportunityScoreForLead', () => {
  beforeEach(resetState)

  it('reads hasCompletedVisit from follow_ups and hasViewedProposal from proposals.first_viewed_at', async () => {
    state.lead = { ai_score: 60, escalation_required: false, follow_up_count: 0 }
    state.proposals = [{ status: 'sent', accepted_at: null, first_viewed_at: '2026-08-01T00:00:00Z' }]
    state.visitCount = 1

    const result = await getOpportunityScoreForLead('lead-1')

    expect(result.components.siteVisitEngagement).toBe(15)
    expect(result.components.proposalEngagement).toBe(15)
  })

  it('scores zero engagement components when there is no visit and no viewed proposal', async () => {
    state.lead = { ai_score: 60, escalation_required: false, follow_up_count: 0 }
    state.proposals = [{ status: 'sent', accepted_at: null, first_viewed_at: null }]
    state.visitCount = 0

    const result = await getOpportunityScoreForLead('lead-2')

    expect(result.components.siteVisitEngagement).toBe(0)
    expect(result.components.proposalEngagement).toBe(0)
  })
})
