import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/chief-of-staff/notification-producer.test.ts
// Version 3.0 (AI Chief of Staff) — Notifications. notification-producer.ts
// is the FIRST-EVER writer of the `notifications` table (see that file's
// header for the schema-uncertainty disclosure). These tests cover the two
// things that matter most given that uncertainty: (1) it never throws, even
// when the insert fails because a column doesn't exist — a notification
// failure must never break the Executive Brief; (2) the spam guard (cap on
// unread notifications per user) actually works, using only the columns
// this codebase has directly confirmed (user_id/is_read/dismissed_at).
// ─────────────────────────────────────────────────────────────────────────────

const state: {
  users: Array<{ id: string }>
  usersError: unknown
  unreadCountByUser: Record<string, number>
  insertShouldFail: boolean
  insertedRows: Array<Record<string, unknown>>
} = {
  users: [{ id: 'user-1' }],
  usersError: null,
  unreadCountByUser: {},
  insertShouldFail: false,
  insertedRows: [],
}

function chainable(result: { data?: unknown; error?: unknown; count?: number }) {
  const handler: Record<string, unknown> = {
    eq: () => handler, in: () => handler, is: () => handler, gte: () => handler, lte: () => handler,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  }
  return handler
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'user_profiles') {
        return { select: () => chainable({ data: state.users, error: state.usersError }) }
      }
      if (table === 'notifications') {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: () => ({
                is: () => Promise.resolve({ count: state.unreadCountByUser[val] ?? 0, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            if (state.insertShouldFail) return Promise.resolve({ error: { message: 'column "title" does not exist' } })
            state.insertedRows.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table in notification-producer test: ${table}`)
    },
  }),
}))

import { notifyMeaningfulEvents } from './notification-producer'
import type { ExecutiveBrief, UrgentProposal } from './executive-brief-service'

function makeBrief(overrides: Partial<ExecutiveBrief> = {}): ExecutiveBrief {
  return {
    date: '2026-08-01',
    windowDays: 90,
    businessHealthScore: { score: 70, factors: [{ key: 'revenueTrend', label: 'Revenue Trend', value: 50, weight: 10, source: 'test' }], formulaNote: 'test' },
    summaries: { business: '', revenue: '', lead: '', proposal: '', booking: '', marketing: '', customer: '', siteVisit: '' },
    todaysPriorities: [],
    predictiveInsights: {
      expectedRevenue: { value: 0, note: '' }, revenueAtRisk: { value: 0, note: '' },
      likelyBookings: { value: null, note: 'Insufficient data' },
      highValueCustomers: { count: 0, thresholdINR: 150_000 }, customersNeedingAttention: { count: 0, thresholdDays: 60 },
      campaignsLikelyToPerform: { name: null, note: 'Insufficient data' }, packagesLikelyToSell: { name: null, note: 'Insufficient data' },
    },
    aiRecommendations: [],
    businessRisks: [],
    businessOpportunities: [],
    founderBrief: {
      today: '2026-08-01',
      todaysOpportunities: [],
      revenuePipeline: { windowDays: 90, leads: { count: 0, revenue: 0 }, visits: { count: 0 }, draftProposals: { count: 0, revenue: 0 }, sentProposals: { count: 0, revenue: 0 }, negotiation: { count: 0, revenue: 0 }, bookings: { count: 0, revenue: 0 }, degraded: false },
      todaysSchedule: { timeline: [], counts: { siteVisits: 0, followUps: 0, proposalReviews: 0 }, proposalReviewsNote: '' },
      morningBrief: { date: '2026-08-01', narrative: '', topOpportunities: [], potentialRevenue: 0, immediateAttentionCount: 0, proposalActivity: { sentLast48h: 0, viewedLast48h: 0 }, visitRemindersCount: 0, recommendedActions: [] },
      lostRevenue: { windowDays: 90, lostLeadsValue: 0, lostLeadsCount: 0, lostProposalsValue: 0, lostProposalsCount: 0, noFollowUp: { count: 0, value: 0 }, reasonBreakdownAvailable: false, gapNote: '', byReason: { noFollowUp: { count: 0, value: 0 }, noResponse: 'Insufficient data', price: 'Insufficient data', capacity: 'Insufficient data', other: 'Insufficient data' } },
      revenueIntelligence: {
        funnel: { stages: [], degraded: false },
        forecast: { openProposalValue: 0, historicalAcceptancePct: 0, pipelineForecast: 0, confirmedNotCompletedRevenue: 0, totalForecast: 0, methodologyNote: '' },
        proposalAnalytics: { total: 0, acceptancePct: 0, avgProposalValue: 0, avgDaysToAcceptance: null, lostProposalReasonsAvailable: false, lostProposalReasonsNote: '' },
        bookingAnalytics: { occupancyPct: 50, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0, revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: false },
        customerAnalytics: { totalCustomers: 0, avgCLV: 0, repeatCustomerPct: 0, newCustomersThisMonth: 0, dormantCustomers: 0, dormantThresholdDays: 60, highValueCustomers: 0, highValueThresholdINR: 150_000 },
        salesProductivity: [],
        eventSales: { eventEnquiries: 0, eventProposals: 0, eventProposalsAccepted: 0, eventProposalConversionPct: 0, eventBookings: 0, eventRevenue: 0, revenueByEventType: [], revenueByVenue: [], revenueByHall: [], revenueByPackage: [], revenueByLeadSource: [], revenueByCampaign: [], campaignAttributionDegraded: false, aiRecommendationSuccess: { totalRecommendations: 0, recommendationsWithPackage: 0, bookedMatchingRecommendation: 0, successRatePct: 0, degraded: false } },
        pipelineBreakdown: { windowDays: 90, leads: { count: 0, revenue: 0 }, visits: { count: 0 }, draftProposals: { count: 0, revenue: 0 }, sentProposals: { count: 0, revenue: 0 }, negotiation: { count: 0, revenue: 0 }, bookings: { count: 0, revenue: 0 } },
        lostRevenue: { windowDays: 90, lostLeadsValue: 0, lostLeadsCount: 0, lostProposalsValue: 0, lostProposalsCount: 0, noFollowUp: { count: 0, value: 0 }, reasonBreakdownAvailable: false, gapNote: '' },
        recentProposals: [], windowDays: 90,
        channelPerformance: [], campaignPerformance: { rows: [], degraded: false },
        marketingBrief: { topPerformingCampaign: null, worstPerformingCampaign: null, highestRevenueChannel: null, lowestConversionChannel: null, budgetRecommendation: '', businessRecommendation: '' },
      },
      followUpsDue: [],
      openLeadsCandidateCount: 0,
    },
    urgentProposalsDegraded: false,
    urgentProposals: [],
    ...overrides,
  }
}

const highValueProposal: UrgentProposal = {
  proposalId: 'prop-1', proposalNumber: '104', leadId: 'lead-1', clientName: 'Mrs. Gupta', totalPrice: 80_000, viewedCount: 5,
  urgency: { urgencyScore: 85, nextAction: 'follow_up_now', riskLevel: 'high', recommendation: 'Follow up.', escalationRequired: false, followUpRequired: true, resendRecommended: false, hoursWithoutResponse: 30, actionLabel: 'Follow Up Now', actionColor: 'text-red-600' },
}

beforeEach(() => {
  state.users = [{ id: 'user-1' }]
  state.usersError = null
  state.unreadCountByUser = {}
  state.insertShouldFail = false
  state.insertedRows = []
})

describe('notifyMeaningfulEvents', () => {
  it('writes a notification for a meaningful event (proposal viewed multiple times, no reply)', async () => {
    const brief = makeBrief()
    const result = await notifyMeaningfulEvents(brief, [highValueProposal])
    expect(result.written).toBeGreaterThan(0)
    expect(state.insertedRows.length).toBe(result.written)
  })

  it('writes nothing when there is nothing meaningful to report', async () => {
    const brief = makeBrief()
    const result = await notifyMeaningfulEvents(brief, [])
    expect(result.written).toBe(0)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('respects the spam cap — does not write for a user who already has enough unread notifications', async () => {
    state.unreadCountByUser['user-1'] = 5 // at cap
    const brief = makeBrief()
    const result = await notifyMeaningfulEvents(brief, [highValueProposal])
    expect(result.skippedCapped).toBe(1)
    expect(state.insertedRows).toHaveLength(0)
  })

  it('never throws when the insert fails (e.g. an assumed column does not really exist) — degrades gracefully', async () => {
    state.insertShouldFail = true
    const brief = makeBrief()
    await expect(notifyMeaningfulEvents(brief, [highValueProposal])).resolves.toBeDefined()
    const result = await notifyMeaningfulEvents(brief, [highValueProposal])
    expect(result.written).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('never throws when the audience lookup itself fails', async () => {
    state.usersError = { message: 'connection reset' }
    const brief = makeBrief()
    const result = await notifyMeaningfulEvents(brief, [highValueProposal])
    expect(result.written).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
