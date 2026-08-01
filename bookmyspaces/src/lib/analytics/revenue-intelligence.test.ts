import { describe, it, expect, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/revenue-intelligence.test.ts
// Sprint 3A — covers the two calculations added to this file for the
// Founder Dashboard: computePipelineBreakdown (Revenue Pipeline card) and
// computeLostRevenue (Lost Revenue Summary card). Both are exercised through
// the real buildRevenueIntelligence() entry point against one shared mock,
// same "one shared mock, real call chain" style as
// reservation-to-proposal.integration.test.ts, rather than unit-testing the
// (unexported) compute functions in isolation — this also incidentally
// verifies nothing about the pre-existing funnel/forecast/etc. sections
// broke when these two were added.
// ─────────────────────────────────────────────────────────────────────────────

const recentISO = new Date().toISOString()

// Generic chainable/thenable query-builder stand-in: every method returns
// itself so any .eq()/.gte()/.not()/.order()/.limit() chain length this file
// uses resolves to the same fixed result, without hand-mirroring each exact
// chain shape.
function makeQueryResult(result: { data?: unknown; error?: unknown; count?: number }) {
  const handler: Record<string, unknown> = {
    eq: () => handler, gte: () => handler, lte: () => handler, not: () => handler,
    order: () => handler, limit: () => handler,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return handler
}

const mockLeads = [
  { id: 'l1', lead_stage: 'NEW', ai_score: 50, estimated_revenue: 100_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 0, next_follow_up_at: null, event_type: 'wedding', source: 'website' },
  { id: 'l2', lead_stage: 'NEGOTIATING', ai_score: 70, estimated_revenue: 200_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 1, next_follow_up_at: null, event_type: 'wedding', source: 'website' },
  { id: 'l3', lead_stage: 'CONFIRMED', ai_score: 90, estimated_revenue: 300_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 2, next_follow_up_at: null, event_type: 'wedding', source: 'referral' },
  { id: 'l4', lead_stage: 'LOST', ai_score: 20, estimated_revenue: 50_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 0, next_follow_up_at: null, event_type: 'birthday', source: 'website' },
  { id: 'l5', lead_stage: 'LOST', ai_score: 20, estimated_revenue: 80_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 3, next_follow_up_at: null, event_type: 'corporate', source: 'website' },
]

const mockProposals = [
  { id: 'p1', lead_id: 'l1', client_name: 'A', status: 'draft', total_price: 10_000, sent_at: null, first_viewed_at: null, accepted_at: null, created_at: recentISO, created_by: null, event_type: null, venue: 'Monurama Homestay', hall: null, package_id: null, package_name: null },
  { id: 'p2', lead_id: 'l2', client_name: 'B', status: 'sent', total_price: 20_000, sent_at: recentISO, first_viewed_at: null, accepted_at: null, created_at: recentISO, created_by: null, event_type: null, venue: 'Monurama Homestay', hall: null, package_id: null, package_name: null },
  { id: 'p3', lead_id: 'l3', client_name: 'C', status: 'accepted', total_price: 30_000, sent_at: recentISO, first_viewed_at: recentISO, accepted_at: recentISO, created_at: recentISO, created_by: null, event_type: null, venue: 'Monurama Homestay', hall: null, package_id: null, package_name: null },
  { id: 'p4', lead_id: 'l4', client_name: 'D', status: 'rejected', total_price: 15_000, sent_at: recentISO, first_viewed_at: null, accepted_at: null, created_at: recentISO, created_by: null, event_type: null, venue: 'Skyline Serenity', hall: null, package_id: null, package_name: null },
  { id: 'p5', lead_id: null, client_name: 'E', status: 'expired', total_price: 5_000, sent_at: null, first_viewed_at: null, accepted_at: null, created_at: recentISO, created_by: null, event_type: null, venue: null, hall: null, package_id: null, package_name: null },
]

const MOCK_SITE_VISITS_COUNT = 3

function tableResult(result: { data?: unknown; error?: unknown; count?: number }) {
  return { select: () => makeQueryResult(result) }
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      switch (table) {
        case 'leads': return tableResult({ data: mockLeads, error: null })
        case 'proposals': return tableResult({ data: mockProposals, error: null })
        case 'reservations': return tableResult({ data: [], error: null })
        case 'stage_transitions': return tableResult({ data: [], error: null })
        case 'inventory_items': return tableResult({ data: null, error: null, count: 0 })
        case 'message_queue': return tableResult({ data: [], error: null })
        case 'broadcast_campaigns': return tableResult({ data: [], error: null })
        case 'ai_interaction_log': return tableResult({ data: [], error: null })
        case 'follow_ups': return tableResult({ data: null, error: null, count: MOCK_SITE_VISITS_COUNT })
        default: throw new Error(`unexpected table in revenue-intelligence test: ${table}`)
      }
    },
  }),
}))

import { buildRevenueIntelligence } from './revenue-intelligence'

describe('buildRevenueIntelligence — pipelineBreakdown (Sprint 3A)', () => {
  it('reuses the funnel for Leads/Negotiation/Bookings and derives Visits/Draft/Sent from data already fetched', async () => {
    const result = await buildRevenueIntelligence(90)
    const pb = result.pipelineBreakdown

    // Leads: the funnel's universal "Lead" bucket — all 5 leads.
    expect(pb.leads.count).toBe(5)
    // Only l3 has an accepted proposal (p3, 30000) — that's the only revenue
    // attributable to the "Lead" bucket (funnel attributes accepted revenue
    // to every stage bucket a lead currently qualifies for).
    expect(pb.leads.revenue).toBe(30_000)

    expect(pb.visits.count).toBe(MOCK_SITE_VISITS_COUNT)

    expect(pb.draftProposals).toEqual({ count: 1, revenue: 10_000 })   // p1 only
    expect(pb.sentProposals).toEqual({ count: 1, revenue: 20_000 })    // p2 only (status 'sent')

    // Negotiation: NEGOTIATING or beyond -> l2 (NEGOTIATING) + l3 (CONFIRMED).
    expect(pb.negotiation.count).toBe(2)
    expect(pb.negotiation.revenue).toBe(30_000) // only l3's accepted proposal

    // Bookings: CONFIRMED only -> l3.
    expect(pb.bookings.count).toBe(1)
    expect(pb.bookings.revenue).toBe(30_000)

    expect(pb.windowDays).toBe(90)
  })

  it('never runs a second query for anything the funnel already computed (pipelineBreakdown.leads matches funnel.stages\' own Lead bucket exactly)', async () => {
    const result = await buildRevenueIntelligence(90)
    const funnelLead = result.funnel.stages.find((s) => s.stage === 'Lead')!
    expect(result.pipelineBreakdown.leads.count).toBe(funnelLead.count)
    expect(result.pipelineBreakdown.leads.revenue).toBe(funnelLead.revenue)
  })
})

describe('buildRevenueIntelligence — lostRevenue (Sprint 3A)', () => {
  it('sums real, existing columns for lost leads and lost proposals', async () => {
    const result = await buildRevenueIntelligence(90)
    const lr = result.lostRevenue

    expect(lr.lostLeadsCount).toBe(2)               // l4, l5
    expect(lr.lostLeadsValue).toBe(130_000)          // 50000 + 80000
    expect(lr.lostProposalsCount).toBe(2)            // p4 (rejected), p5 (expired)
    expect(lr.lostProposalsValue).toBe(20_000)       // 15000 + 5000
  })

  it('derives "No Follow-up" only from the real follow_up_count column, never inventing a reason', async () => {
    const result = await buildRevenueIntelligence(90)
    const lr = result.lostRevenue

    // Only l4 is LOST with follow_up_count === 0; l5 was followed up 3 times.
    expect(lr.noFollowUp).toEqual({ count: 1, value: 50_000 })
  })

  it('explicitly reports the reason-breakdown gap rather than fabricating No Response/Price/Capacity/Other', async () => {
    const result = await buildRevenueIntelligence(90)
    expect(result.lostRevenue.reasonBreakdownAvailable).toBe(false)
    expect(result.lostRevenue.gapNote).toMatch(/no lost_reason\/rejection_reason field exists/i)
  })
})

describe('buildRevenueIntelligence — recentProposals (Sprint 3A)', () => {
  it('exposes the window-filtered proposals array so callers do not need a second proposals query', async () => {
    const result = await buildRevenueIntelligence(90)
    expect(result.recentProposals).toHaveLength(mockProposals.length)
    expect(result.recentProposals.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})
