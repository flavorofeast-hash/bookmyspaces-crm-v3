import { describe, it, expect, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/revenue-intelligence.multi-touch.test.ts
// Growth Engine Epic 6 — isolated mock (deliberately separate from
// revenue-intelligence.test.ts's shared fixture) so campaign-send timing can
// be controlled precisely: linear multi-touch attribution depends on
// message_queue.created_at ordering relative to each proposal's
// accepted_at, which the other test file's fixture doesn't exercise.
// ─────────────────────────────────────────────────────────────────────────────

const t0 = '2026-01-01T00:00:00.000Z' // camp A sent to l1 and l2
const t1 = '2026-01-05T00:00:00.000Z' // camp B sent to l1 (still before either acceptance)
const tAccept = '2026-01-10T00:00:00.000Z' // both proposals accepted here
const tAfter = '2026-01-15T00:00:00.000Z' // camp C sent to l3 AFTER l3's proposal was accepted

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
function tableResult(result: { data?: unknown; error?: unknown; count?: number }) {
  return { select: () => makeQueryResult(result) }
}

const mockLeads = [
  { id: 'l1', lead_stage: 'CONFIRMED', ai_score: 80, estimated_revenue: 100_000, assigned_to: null, created_at: t0, last_contacted_at: null, follow_up_count: 0, next_follow_up_at: null, event_type: 'wedding', source: 'website' },
  { id: 'l2', lead_stage: 'CONFIRMED', ai_score: 80, estimated_revenue: 50_000, assigned_to: null, created_at: t0, last_contacted_at: null, follow_up_count: 0, next_follow_up_at: null, event_type: 'wedding', source: 'website' },
  { id: 'l3', lead_stage: 'CONFIRMED', ai_score: 80, estimated_revenue: 20_000, assigned_to: null, created_at: t0, last_contacted_at: null, follow_up_count: 0, next_follow_up_at: null, event_type: 'wedding', source: 'website' },
]

const mockProposals = [
  { id: 'p1', lead_id: 'l1', client_name: 'A', status: 'accepted', total_price: 100_000, sent_at: t0, first_viewed_at: t0, accepted_at: tAccept, created_at: t0, created_by: null, event_type: null, venue: null, hall: null, package_id: null, package_name: null },
  { id: 'p2', lead_id: 'l2', client_name: 'B', status: 'accepted', total_price: 50_000, sent_at: t0, first_viewed_at: t0, accepted_at: tAccept, created_at: t0, created_by: null, event_type: null, venue: null, hall: null, package_id: null, package_name: null },
  { id: 'p3', lead_id: 'l3', client_name: 'C', status: 'accepted', total_price: 20_000, sent_at: t0, first_viewed_at: t0, accepted_at: tAccept, created_at: t0, created_by: null, event_type: null, venue: null, hall: null, package_id: null, package_name: null },
]

// l1: sent camp A (t0) then camp B (t1) — both before acceptance -> linear split.
// l2: sent camp A only (t0) -> all revenue to camp A.
// l3: sent camp C, but AFTER its proposal was accepted -> excluded from linear
//     revenue entirely, though still counted as a "touched" lead.
const mockCampaignSends = [
  { lead_id: 'l1', metadata: { campaign_id: 'campA' }, created_at: t0 },
  { lead_id: 'l1', metadata: { campaign_id: 'campB' }, created_at: t1 },
  { lead_id: 'l2', metadata: { campaign_id: 'campA' }, created_at: t0 },
  { lead_id: 'l3', metadata: { campaign_id: 'campC' }, created_at: tAfter },
]

const mockCampaignNames = [
  { id: 'campA', name: 'Campaign A', budget: null },
  { id: 'campB', name: 'Campaign B', budget: null },
  { id: 'campC', name: 'Campaign C', budget: null },
]

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      switch (table) {
        case 'leads': return {
          select: (cols?: string) => {
            if (cols && cols.startsWith('id, campaign')) {
              return makeQueryResult({ data: mockLeads.map((l) => ({ id: l.id, campaign: null, utm_source: null, utm_medium: null })), error: null })
            }
            return makeQueryResult({ data: mockLeads, error: null })
          },
        }
        case 'proposals': return tableResult({ data: mockProposals, error: null })
        case 'reservations': return tableResult({ data: [], error: null })
        case 'stage_transitions': return tableResult({ data: [], error: null })
        case 'inventory_items': return tableResult({ data: null, error: null, count: 0 })
        case 'message_queue': return tableResult({ data: mockCampaignSends, error: null })
        case 'broadcast_campaigns': return tableResult({ data: mockCampaignNames, error: null })
        case 'ai_interaction_log': return tableResult({ data: [], error: null })
        case 'follow_ups': return tableResult({ data: null, error: null, count: 0 })
        default: throw new Error(`unexpected table in multi-touch test: ${table}`)
      }
    },
  }),
}))

import { buildRevenueIntelligence } from './revenue-intelligence'

describe('multiTouchAttribution (Growth Engine Epic 6)', () => {
  it('splits revenue linearly across every campaign sent before acceptance', async () => {
    const result = await buildRevenueIntelligence(365)
    const rows = result.multiTouchAttribution.rows

    const campA = rows.find((r) => r.campaignId === 'campA')!
    const campB = rows.find((r) => r.campaignId === 'campB')!
    // l1's 100k splits 50/50 between campA and campB; l2's 50k goes entirely to campA.
    expect(campA.linearRevenue).toBe(50_000 + 50_000)
    expect(campB.linearRevenue).toBe(50_000)
  })

  it('excludes a touch that happened after the proposal was already accepted', async () => {
    const result = await buildRevenueIntelligence(365)
    const campC = result.multiTouchAttribution.rows.find((r) => r.campaignId === 'campC')!
    expect(campC.linearRevenue).toBe(0)
    expect(campC.touchedLeads).toBe(1) // still recorded as a real touch, just not revenue-attributed
  })

  it('firstTouchRevenue matches the pre-existing first-touch definition (whichever campaign was sent first)', async () => {
    const result = await buildRevenueIntelligence(365)
    const campA = result.multiTouchAttribution.rows.find((r) => r.campaignId === 'campA')!
    const campB = result.multiTouchAttribution.rows.find((r) => r.campaignId === 'campB')!
    // campA was l1's first touch (t0, before campB's t1), so first-touch credits
    // campA with the FULL revenue from both l1 and l2 — campB gets none.
    expect(campA.firstTouchRevenue).toBe(150_000)
    expect(campB.firstTouchRevenue).toBe(0)
  })

  it('does not change the existing first-touch campaignROI numbers', async () => {
    const result = await buildRevenueIntelligence(365)
    const campA = result.campaignROI.rows.find((r) => r.campaignId === 'campA')!
    expect(campA.revenue).toBe(150_000)
  })
})
