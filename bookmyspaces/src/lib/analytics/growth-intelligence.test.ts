import { describe, it, expect } from 'vitest'
import { computeGrowthIntelligence } from './growth-intelligence'
import type { RevenueIntelligence } from './revenue-intelligence'
import type { LoyaltyOverview } from '@/lib/customers/loyalty'
import type { ReferralPerformance } from '@/lib/customers/referrals'

// Minimal-but-real RevenueIntelligence stand-in — only the fields
// computeGrowthIntelligence actually reads are filled with meaningful
// values; everything else is a valid-shaped zero/empty default so the type
// checks without dragging in the full 12-section object.
function makeRI(overrides: Partial<RevenueIntelligence> = {}): RevenueIntelligence {
  return {
    funnel: { stages: [], degraded: false },
    forecast: { openProposalValue: 0, historicalAcceptancePct: 0, pipelineForecast: 0, confirmedNotCompletedRevenue: 0, totalForecast: 0, methodologyNote: '' },
    proposalAnalytics: { total: 0, acceptancePct: 0, avgProposalValue: 0, avgDaysToAcceptance: null, lostProposalReasonsAvailable: false, lostProposalReasonsNote: '' },
    bookingAnalytics: { occupancyPct: 30, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: false },
    customerAnalytics: { totalCustomers: 10, avgCLV: 120_000, repeatCustomerPct: 25, newCustomersThisMonth: 2, dormantCustomers: 3, dormantThresholdDays: 60, highValueCustomers: 2, highValueThresholdINR: 150_000 },
    salesProductivity: [],
    eventSales: {
      eventEnquiries: 0, eventProposals: 0, eventProposalsAccepted: 0, eventProposalConversionPct: 0, eventBookings: 0, eventRevenue: 0,
      revenueByEventType: [], revenueByVenue: [], revenueByHall: [], revenueByPackage: [], revenueByLeadSource: [], revenueByCampaign: [],
      campaignAttributionDegraded: false,
      aiRecommendationSuccess: { totalRecommendations: 0, recommendationsWithPackage: 0, bookedMatchingRecommendation: 0, successRatePct: 0, degraded: false },
    },
    pipelineBreakdown: { windowDays: 90, leads: { count: 0, revenue: 0 }, visits: { count: 0 }, draftProposals: { count: 0, revenue: 0 }, sentProposals: { count: 0, revenue: 0 }, negotiation: { count: 0, revenue: 0 }, bookings: { count: 0, revenue: 0 } },
    lostRevenue: { windowDays: 90, lostLeadsValue: 0, lostLeadsCount: 0, lostProposalsValue: 0, lostProposalsCount: 0, noFollowUp: { count: 0, value: 0 }, reasonBreakdownAvailable: false, gapNote: '' },
    recentProposals: [],
    windowDays: 90,
    channelPerformance: [],
    campaignPerformance: { rows: [], degraded: false },
    marketingBrief: { topPerformingCampaign: null, worstPerformingCampaign: null, highestRevenueChannel: null, lowestConversionChannel: null, budgetRecommendation: 'Base budget call.', businessRecommendation: '' },
    campaignROI: { rows: [], degraded: false, note: '' },
    multiTouchAttribution: { model: 'linear', rows: [], degraded: false, note: '' },
    ...overrides,
  }
}

const emptyLoyalty: LoyaltyOverview = { totalAccounts: 0, totalPointsIssued: 0, byTier: [], topEarners: [] }
const emptyReferral: ReferralPerformance = { totalLeadsWithReferralText: 0, attributedReferrals: 0, unattributedReferralText: 0, topReferrers: [], note: '' }
const noRewards = { pending: 0, earned: 0, redeemed: 0 }

describe('computeGrowthIntelligence', () => {
  it('flags dormant customers as both a revenue opportunity and a retention suggestion', () => {
    const gi = computeGrowthIntelligence(makeRI(), emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.revenueOpportunities.some((o) => o.title.includes('dormant'))).toBe(true)
    expect(gi.retentionSuggestions.some((s) => s.includes('Dormant Win-back'))).toBe(true)
    expect(gi.customerHealth.dormantCustomers).toBe(3)
  })

  it('surfaces VIP tier count as a revenue opportunity', () => {
    const loyalty: LoyaltyOverview = { ...emptyLoyalty, byTier: [{ tier: 'VIP', count: 4 }] }
    const gi = computeGrowthIntelligence(makeRI(), loyalty, emptyReferral, noRewards, [])
    expect(gi.revenueOpportunities.some((o) => o.title.includes('4 customers at VIP'))).toBe(true)
  })

  it('recommends scaling the highest-ROI campaign with a budget set', () => {
    const ri = makeRI({
      campaignROI: {
        rows: [
          { campaignId: 'c1', campaignName: 'Camp A', budget: 10_000, revenue: 50_000, leadsReached: 5, bookings: 2, roi: 5, roiAvailable: true },
          { campaignId: 'c2', campaignName: 'Camp B', budget: 10_000, revenue: 5_000, leadsReached: 5, bookings: 1, roi: 0.5, roiAvailable: true },
        ],
        degraded: false,
        note: '',
      },
    })
    const gi = computeGrowthIntelligence(ri, emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.revenueOpportunities.some((o) => o.title.includes('Camp A') && o.title.includes('5x'))).toBe(true)
    expect(gi.revenueOpportunities.some((o) => o.title.includes('Camp B'))).toBe(false)
  })

  it('gives a low-occupancy recommendation below 40%', () => {
    const gi = computeGrowthIntelligence(makeRI({ bookingAnalytics: { occupancyPct: 20, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: false } }), emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.occupancyRecommendation).toMatch(/promotion/)
  })

  it('gives a high-occupancy recommendation above 85%', () => {
    const gi = computeGrowthIntelligence(makeRI({ bookingAnalytics: { occupancyPct: 90, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: false } }), emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.occupancyRecommendation).toMatch(/dynamic pricing/)
  })

  it('never fabricates an occupancy call when the figure is unavailable', () => {
    const gi = computeGrowthIntelligence(makeRI({ bookingAnalytics: { occupancyPct: null, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: false } }), emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.occupancyRecommendation).toMatch(/cannot be computed/)
  })

  it('surfaces a review-reminder gap when requests outpace completions', () => {
    const journeyFunnel = [{ stage: 'review_requested', count: 10 }, { stage: 'review_completed', count: 3 }]
    const gi = computeGrowthIntelligence(makeRI(), emptyLoyalty, emptyReferral, noRewards, journeyFunnel)
    expect(gi.retentionSuggestions.some((s) => s.includes('7 review request'))).toBe(true)
  })

  it('layers the multi-touch under-credit finding onto the existing marketing brief budget call', () => {
    const ri = makeRI({
      multiTouchAttribution: {
        model: 'linear',
        rows: [{ campaignId: 'c1', campaignName: 'Camp A', linearRevenue: 80_000, firstTouchRevenue: 20_000, touchedLeads: 5 }],
        degraded: false,
        note: '',
      },
    })
    const gi = computeGrowthIntelligence(ri, emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.campaignRecommendation).toContain('Base budget call.')
    expect(gi.campaignRecommendation).toContain('Camp A')
    expect(gi.campaignRecommendation).toContain('under-credited')
  })

  it('falls back to a neutral message when nothing is flagged', () => {
    const ri = makeRI({ customerAnalytics: { totalCustomers: 0, avgCLV: 0, repeatCustomerPct: 0, newCustomersThisMonth: 0, dormantCustomers: 0, dormantThresholdDays: 60, highValueCustomers: 0, highValueThresholdINR: 150_000 } })
    const gi = computeGrowthIntelligence(ri, emptyLoyalty, emptyReferral, noRewards, [])
    expect(gi.retentionSuggestions).toEqual(['No retention risks currently flagged from available data.'])
  })
})
