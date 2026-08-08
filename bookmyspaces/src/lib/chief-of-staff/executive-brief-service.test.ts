import { describe, it, expect } from 'vitest'
import type { RevenueIntelligence } from '@/lib/analytics/revenue-intelligence'
import type { FounderBrief, Opportunity } from '@/lib/founder/founder-brief-service'
import type { UrgentProposal } from './executive-brief-service'
import {
  computeBusinessHealthScore,
  computeTodaysPriorities,
  computePredictiveInsights,
  computeAIRecommendations,
  computeBusinessRisks,
  computeBusinessOpportunities,
  computeExecutiveSummaries,
} from './executive-brief-service'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/chief-of-staff/executive-brief-service.test.ts
// Version 3.0 (AI Chief of Staff). Every function under test here is PURE —
// it takes an already-computed RevenueIntelligence/FounderBrief/
// UrgentProposal[] and composes/ranks/formats, with zero DB calls of its
// own. So these are plain unit tests against hand-built fixtures, not a
// Supabase mock — same style as revenue-intelligence.test.ts's compute
// functions would be if they were exported directly, and much cheaper than
// mocking the full buildFounderBrief()/buildRevenueIntelligence() chain for
// every scenario.
// ─────────────────────────────────────────────────────────────────────────────

function makeRevenueIntelligence(overrides: Partial<RevenueIntelligence> = {}): RevenueIntelligence {
  const base: RevenueIntelligence = {
    funnel: {
      stages: [
        { stage: 'Lead', count: 100, revenue: 0, conversionFromPreviousPct: null, avgDaysInPreviousStage: null },
        { stage: 'Qualified', count: 60, revenue: 0, conversionFromPreviousPct: 60, avgDaysInPreviousStage: null },
        { stage: 'Proposal', count: 30, revenue: 0, conversionFromPreviousPct: 50, avgDaysInPreviousStage: null },
        { stage: 'Negotiation', count: 20, revenue: 0, conversionFromPreviousPct: 66.7, avgDaysInPreviousStage: null },
        { stage: 'Booked', count: 10, revenue: 500_000, conversionFromPreviousPct: 50, avgDaysInPreviousStage: null },
        { stage: 'Completed', count: 5, revenue: 250_000, conversionFromPreviousPct: null, avgDaysInPreviousStage: null },
      ],
      degraded: false,
    },
    forecast: {
      openProposalValue: 400_000,
      historicalAcceptancePct: 50,
      pipelineForecast: 200_000,
      confirmedNotCompletedRevenue: 100_000,
      totalForecast: 300_000,
      methodologyNote: 'test methodology note',
    },
    proposalAnalytics: {
      total: 30,
      acceptancePct: 40,
      avgProposalValue: 50_000,
      avgDaysToAcceptance: 3,
      lostProposalReasonsAvailable: false,
      lostProposalReasonsNote: 'test note',
    },
    bookingAnalytics: {
      occupancyPct: 60,
      adr: 3000,
      totalBookings: 10,
      cancelledBookings: 1,
      cancellationPct: 10,
      revenueByMonth: [
        { month: 'Mar 26', revenue: 100_000, bookings: 2 },
        { month: 'Apr 26', revenue: 100_000, bookings: 2 },
        { month: 'May 26', revenue: 100_000, bookings: 2 },
        { month: 'Jun 26', revenue: 100_000, bookings: 2 },
        { month: 'Jul 26', revenue: 100_000, bookings: 2 },
        { month: 'Aug 26', revenue: 150_000, bookings: 3 },
      ],
      repeatBookingCustomers: 2,
      repeatBookingPct: 20,
      degraded: false,
    },
    customerAnalytics: {
      totalCustomers: 100,
      avgCLV: 50_000,
      repeatCustomerPct: 20,
      newCustomersThisMonth: 10,
      dormantCustomers: 15,
      dormantThresholdDays: 60,
      highValueCustomers: 8,
      highValueThresholdINR: 150_000,
    },
    salesProductivity: [],
    eventSales: {
      eventEnquiries: 50,
      eventProposals: 30,
      eventProposalsAccepted: 12,
      eventProposalConversionPct: 40,
      eventBookings: 10,
      eventRevenue: 500_000,
      revenueByEventType: [{ key: 'Wedding', proposals: 20, accepted: 8, revenue: 400_000 }],
      revenueByVenue: [{ key: 'Monurama Homestay', proposals: 20, accepted: 8, revenue: 400_000 }],
      revenueByHall: [],
      revenueByPackage: [{ key: 'Gold', proposals: 15, accepted: 6, revenue: 300_000 }],
      revenueByLeadSource: [],
      revenueByCampaign: [],
      campaignAttributionDegraded: false,
      aiRecommendationSuccess: { totalRecommendations: 0, recommendationsWithPackage: 0, bookedMatchingRecommendation: 0, successRatePct: 0, degraded: false },
    },
    pipelineBreakdown: {
      windowDays: 90,
      leads: { count: 100, revenue: 0 },
      visits: { count: 5 },
      draftProposals: { count: 5, revenue: 100_000 },
      sentProposals: { count: 10, revenue: 300_000 },
      negotiation: { count: 20, revenue: 200_000 },
      bookings: { count: 10, revenue: 500_000 },
    },
    lostRevenue: {
      windowDays: 90,
      lostLeadsValue: 100_000,
      lostLeadsCount: 5,
      lostProposalsValue: 20_000,
      lostProposalsCount: 2,
      noFollowUp: { count: 2, value: 40_000 },
      reasonBreakdownAvailable: false,
      gapNote: 'test gap note',
    },
    recentProposals: [],
    windowDays: 90,
    channelPerformance: [
      { key: 'website', leads: 40, qualifiedLeads: 20, proposals: 15, bookings: 5, revenue: 250_000, conversionPct: 12.5, avgBookingValue: 50_000 },
      { key: 'referral', leads: 10, qualifiedLeads: 8, proposals: 6, bookings: 4, revenue: 200_000, conversionPct: 40, avgBookingValue: 50_000 },
    ],
    campaignPerformance: {
      rows: [
        { key: 'summer-wedding-fb-ad', leads: 20, qualifiedLeads: 10, proposals: 8, bookings: 3, revenue: 150_000, conversionPct: 15, avgBookingValue: 50_000 },
        { key: 'Organic / No Campaign', leads: 30, qualifiedLeads: 18, proposals: 13, bookings: 6, revenue: 300_000, conversionPct: 20, avgBookingValue: 50_000 },
      ],
      degraded: false,
    },
    // Not exercised by any assertion in this file — present only to satisfy
    // RevenueIntelligence's shape (added after this fixture was written).
    campaignROI: { rows: [], degraded: true, note: 'not used by these tests' },
    multiTouchAttribution: { model: 'linear', rows: [], degraded: true, note: 'not used by these tests' },
    marketingBrief: {
      topPerformingCampaign: 'summer-wedding-fb-ad',
      worstPerformingCampaign: null,
      highestRevenueChannel: 'website',
      lowestConversionChannel: 'website',
      budgetRecommendation: 'Prioritize "summer-wedding-fb-ad".',
      businessRecommendation: '"website" is the highest-revenue channel.',
    },
  }
  return { ...base, ...overrides }
}

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    leadId: 'lead-1',
    customerName: 'Mr. Sharma',
    eventType: 'wedding',
    eventDate: null,
    guestCount: 150,
    property: 'Monurama Homestay',
    revenueProbability: { score: 82, band: 'HIGH' },
    expectedRevenue: 65_000,
    expectedRevenueSource: 'proposal',
    nextAction: { action: 'call_immediately', label: 'Call Now', color: 'text-red-600' },
    urgencyScore: 90,
    ...overrides,
  }
}

function makeFounderBrief(overrides: Partial<FounderBrief> = {}): FounderBrief {
  const revenueIntelligence = overrides.revenueIntelligence ?? makeRevenueIntelligence()
  const base: FounderBrief = {
    today: '2026-08-01',
    todaysOpportunities: [makeOpportunity()],
    revenuePipeline: { ...revenueIntelligence.pipelineBreakdown, degraded: false },
    todaysSchedule: {
      timeline: [],
      counts: { siteVisits: 2, followUps: 3, proposalReviews: 1 },
      proposalReviewsNote: 'test note',
    },
    morningBrief: {
      date: '2026-08-01',
      narrative: 'Good Morning. Test narrative.',
      topOpportunities: [makeOpportunity()],
      potentialRevenue: 65_000,
      immediateAttentionCount: 1,
      proposalActivity: { sentLast48h: 2, viewedLast48h: 1 },
      visitRemindersCount: 2,
      recommendedActions: ['Mr. Sharma (wedding) — Call Now (Revenue Probability 82/100)'],
    },
    lostRevenue: {
      ...revenueIntelligence.lostRevenue,
      byReason: {
        noFollowUp: revenueIntelligence.lostRevenue.noFollowUp,
        noResponse: 'Insufficient data',
        price: 'Insufficient data',
        capacity: 'Insufficient data',
        other: 'Insufficient data',
      },
    },
    revenueIntelligence,
    followUpsDue: [{ id: 'lead-2', name: 'Mr. Roy', phone: '919999999999', next_follow_up_at: '2026-08-01T10:00:00+05:30', lead_stage: 'CONTACTED', ai_score: 55 }],
    openLeadsCandidateCount: 12,
  }
  return { ...base, ...overrides }
}

function makeUrgentProposal(overrides: Partial<UrgentProposal> = {}): UrgentProposal {
  return {
    proposalId: 'prop-1',
    proposalNumber: '104',
    leadId: 'lead-3',
    clientName: 'Mrs. Gupta',
    totalPrice: 80_000,
    viewedCount: 5,
    urgency: {
      urgencyScore: 85,
      nextAction: 'follow_up_now',
      riskLevel: 'high',
      recommendation: 'Customer viewed the proposal 30h ago with no reply. Follow up immediately.',
      escalationRequired: false,
      followUpRequired: true,
      resendRecommended: false,
      hoursWithoutResponse: 30,
      actionLabel: 'Follow Up Now',
      actionColor: 'text-red-600',
    },
    ...overrides,
  }
}

describe('computeBusinessHealthScore', () => {
  it('computes a weighted 0-100 score from existing revenue-intelligence fields when all factors have data', () => {
    const result = computeBusinessHealthScore(makeRevenueIntelligence())
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.factors).toHaveLength(8)
    expect(result.formulaNote).toMatch(/weights sum to 100/i)
  })

  it('re-normalizes weights and discloses exclusion when a factor has no real data (e.g. zero decided proposals)', () => {
    const ri = makeRevenueIntelligence({
      proposalAnalytics: { total: 0, acceptancePct: 0, avgProposalValue: 0, avgDaysToAcceptance: null, lostProposalReasonsAvailable: false, lostProposalReasonsNote: '' },
    })
    const result = computeBusinessHealthScore(ri)
    const proposalFactor = result.factors.find((f) => f.key === 'proposalConversion')!
    expect(proposalFactor.value).toBeNull() // not fabricated as 0%
    expect(result.formulaNote).toMatch(/7\/8 available/)
  })

  it('never includes a "Response Time" factor — no aggregate response-time metric exists anywhere in this codebase', () => {
    const result = computeBusinessHealthScore(makeRevenueIntelligence())
    expect(result.factors.find((f) => f.key.toLowerCase().includes('response'))).toBeUndefined()
  })

  it('returns score 0 (not NaN/crash) when literally every factor is insufficient data', () => {
    const ri = makeRevenueIntelligence({
      funnel: { stages: [], degraded: true },
      pipelineBreakdown: { windowDays: 90, leads: { count: 0, revenue: 0 }, visits: { count: 0 }, draftProposals: { count: 0, revenue: 0 }, sentProposals: { count: 0, revenue: 0 }, negotiation: { count: 0, revenue: 0 }, bookings: { count: 0, revenue: 0 } },
      proposalAnalytics: { total: 0, acceptancePct: 0, avgProposalValue: 0, avgDaysToAcceptance: null, lostProposalReasonsAvailable: false, lostProposalReasonsNote: '' },
      channelPerformance: [],
      bookingAnalytics: { occupancyPct: null, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: true },
      lostRevenue: { windowDays: 90, lostLeadsValue: 0, lostLeadsCount: 0, lostProposalsValue: 0, lostProposalsCount: 0, noFollowUp: { count: 0, value: 0 }, reasonBreakdownAvailable: false, gapNote: '' },
      customerAnalytics: { totalCustomers: 0, avgCLV: 0, repeatCustomerPct: 0, newCustomersThisMonth: 0, dormantCustomers: 0, dormantThresholdDays: 60, highValueCustomers: 0, highValueThresholdINR: 150_000 },
    })
    const result = computeBusinessHealthScore(ri)
    expect(result.score).toBe(0)
    expect(Number.isNaN(result.score)).toBe(false)
  })
})

describe('computeTodaysPriorities', () => {
  it('ranks by each source\'s own existing urgency number, highest first', () => {
    const brief = makeFounderBrief()
    const urgentProposal = makeUrgentProposal({ urgency: { ...makeUrgentProposal().urgency, urgencyScore: 95 } })
    const result = computeTodaysPriorities(brief, [urgentProposal])
    expect(result[0].urgencyScore).toBeGreaterThanOrEqual(result[result.length - 1].urgencyScore)
  })

  it('surfaces real proposal engagement data (viewed_count) in the reason string, never a fabricated count', () => {
    const brief = makeFounderBrief()
    const urgentProposal = makeUrgentProposal()
    const result = computeTodaysPriorities(brief, [urgentProposal])
    const proposalItem = result.find((i) => i.category === 'proposal')!
    expect(proposalItem.reason).toContain('Viewed 5 times')
  })

  it('excludes open proposals that are not flagged as needing action', () => {
    const brief = makeFounderBrief()
    const quietProposal = makeUrgentProposal({
      proposalId: 'prop-quiet',
      urgency: { ...makeUrgentProposal().urgency, followUpRequired: false, resendRecommended: false, escalationRequired: false, nextAction: 'awaiting_response' },
    })
    const result = computeTodaysPriorities(brief, [quietProposal])
    expect(result.find((i) => i.id === 'proposal:prop-quiet')).toBeUndefined()
  })

  it('does not double-list a lead that already appears as a today\'s-opportunity', () => {
    const brief = makeFounderBrief({
      todaysOpportunities: [makeOpportunity({ leadId: 'lead-2' })],
      followUpsDue: [{ id: 'lead-2', name: 'Mr. Roy', phone: '919999999999', next_follow_up_at: '2026-08-01T10:00:00+05:30', lead_stage: 'CONTACTED', ai_score: 55 }],
    })
    const result = computeTodaysPriorities(brief, [])
    expect(result.filter((i) => i.leadId === 'lead-2')).toHaveLength(1)
  })

  it('respects the limit parameter', () => {
    const brief = makeFounderBrief()
    const result = computeTodaysPriorities(brief, [], 1)
    expect(result).toHaveLength(1)
  })
})

describe('computePredictiveInsights', () => {
  it('reads Expected Revenue directly from the existing forecast, never recomputed', () => {
    const ri = makeRevenueIntelligence()
    const insights = computePredictiveInsights(ri, [])
    expect(insights.expectedRevenue.value).toBe(ri.forecast.totalForecast)
  })

  it('computes Revenue at Risk as the sum of flagged open proposals only', () => {
    const ri = makeRevenueIntelligence()
    const flagged = makeUrgentProposal({ totalPrice: 80_000 })
    const notFlagged = makeUrgentProposal({ proposalId: 'prop-2', totalPrice: 999_999, urgency: { ...makeUrgentProposal().urgency, followUpRequired: false, resendRecommended: false, escalationRequired: false } })
    const insights = computePredictiveInsights(ri, [flagged, notFlagged])
    expect(insights.revenueAtRisk.value).toBe(80_000)
  })

  it('reports "Insufficient data" for Likely Bookings when avgProposalValue is 0, never divides by zero', () => {
    const ri = makeRevenueIntelligence({ proposalAnalytics: { total: 0, acceptancePct: 0, avgProposalValue: 0, avgDaysToAcceptance: null, lostProposalReasonsAvailable: false, lostProposalReasonsNote: '' } })
    const insights = computePredictiveInsights(ri, [])
    expect(insights.likelyBookings.value).toBeNull()
    expect(insights.likelyBookings.note).toBe('Insufficient data')
  })

  it('excludes low-volume and degraded campaigns from "Campaigns Likely to Perform"', () => {
    const ri = makeRevenueIntelligence({
      campaignPerformance: { rows: [{ key: 'tiny-campaign', leads: 1, qualifiedLeads: 1, proposals: 1, bookings: 1, revenue: 100_000, conversionPct: 100, avgBookingValue: 100_000 }], degraded: false },
    })
    const insights = computePredictiveInsights(ri, [])
    expect(insights.campaignsLikelyToPerform.name).toBeNull()
  })
})

describe('computeAIRecommendations', () => {
  it('produces specific, named recommendations — never generic text', () => {
    const brief = makeFounderBrief()
    const priorities = computeTodaysPriorities(brief, [makeUrgentProposal()])
    const recs = computeAIRecommendations(priorities, brief.revenueIntelligence)
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.some((r) => r.includes('Mr. Sharma') || r.includes('Mrs. Gupta') || r.includes('summer-wedding-fb-ad') || r.includes('website') || r.includes('Gold'))).toBe(true)
    for (const r of recs) {
      expect(r.toLowerCase()).not.toMatch(/^follow up with leads\.?$/)
    }
  })

  it('deduplicates identical recommendations', () => {
    const brief = makeFounderBrief()
    const recs = computeAIRecommendations([], brief.revenueIntelligence)
    expect(new Set(recs).size).toBe(recs.length)
  })
})

describe('computeBusinessRisks', () => {
  it('flags a real risk only when a real threshold is crossed', () => {
    const risks = computeBusinessRisks(makeRevenueIntelligence())
    expect(risks.some((r) => r.includes('lost'))).toBe(true)
  })

  it('returns an empty list (not a fabricated risk) when nothing crosses a threshold', () => {
    const ri = makeRevenueIntelligence({
      lostRevenue: { windowDays: 90, lostLeadsValue: 0, lostLeadsCount: 0, lostProposalsValue: 0, lostProposalsCount: 0, noFollowUp: { count: 0, value: 0 }, reasonBreakdownAvailable: false, gapNote: '' },
      bookingAnalytics: { occupancyPct: 40, adr: 3000, totalBookings: 10, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: false },
      channelPerformance: [{ key: 'website', leads: 40, qualifiedLeads: 20, proposals: 15, bookings: 10, revenue: 250_000, conversionPct: 25, avgBookingValue: 25_000 }],
    })
    const risks = computeBusinessRisks(ri)
    expect(risks).toHaveLength(0)
  })

  it('flags capacity risk only at or above the 85% threshold', () => {
    const ri = makeRevenueIntelligence({ bookingAnalytics: { ...makeRevenueIntelligence().bookingAnalytics, occupancyPct: 90 } })
    const risks = computeBusinessRisks(ri)
    expect(risks.some((r) => r.includes('Capacity'))).toBe(true)
  })
})

describe('computeBusinessOpportunities', () => {
  it('surfaces the top-converting channel with real numbers', () => {
    const opportunities = computeBusinessOpportunities(makeRevenueIntelligence(), [])
    expect(opportunities.some((o) => o.includes('referral') && o.includes('40%'))).toBe(true)
  })

  it('flags close-now opportunities from freshly-viewed proposals', () => {
    const closeNow = makeUrgentProposal({ urgency: { ...makeUrgentProposal().urgency, nextAction: 'close_deal' } })
    const opportunities = computeBusinessOpportunities(makeRevenueIntelligence(), [closeNow])
    expect(opportunities.some((o) => o.includes('viewed'))).toBe(true)
  })
})

describe('computeExecutiveSummaries', () => {
  it('composes all 8 summaries from existing fields without introducing new numbers', () => {
    const brief = makeFounderBrief()
    const health = computeBusinessHealthScore(brief.revenueIntelligence)
    const summaries = computeExecutiveSummaries(brief, health)
    expect(summaries.business).toContain(String(health.score))
    expect(summaries.revenue).toContain('3,00,000') // forecast total, Indian digit grouping
    expect(summaries.siteVisit).toContain('2') // todaysSchedule.counts.siteVisits
  })

  it('discloses degraded booking data rather than showing zeros', () => {
    const ri = makeRevenueIntelligence({ bookingAnalytics: { occupancyPct: null, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: true } })
    const brief = makeFounderBrief({ revenueIntelligence: ri })
    const health = computeBusinessHealthScore(ri)
    const summaries = computeExecutiveSummaries(brief, health)
    expect(summaries.booking).toMatch(/not live/i)
  })
})
