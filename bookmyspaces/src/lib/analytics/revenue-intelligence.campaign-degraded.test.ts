import { describe, it, expect, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/revenue-intelligence.campaign-degraded.test.ts
// Version 2.1 (Marketing Intelligence) — the one scenario the design
// deliberately protects against: migration 026 (leads.campaign/utm_source/
// utm_medium) not being live in production (its status is genuinely
// unverified, see PRODUCTION_VERIFICATION_REPORT.md's ENG-034). Campaign/
// UTM columns are fetched via a SEPARATE, isolated query in fetchRawData()
// specifically so a missing migration only degrades campaignPerformance,
// never the core leads array every other section of this file depends on.
// This is a dedicated file (its own vi.mock) rather than a second describe
// block in revenue-intelligence.test.ts, since the two files need genuinely
// different mock wiring for the 'leads' table's second query.
// ─────────────────────────────────────────────────────────────────────────────

const recentISO = new Date().toISOString()

function makeQueryResult(result: { data?: unknown; error?: unknown; count?: number }) {
  const handler: Record<string, unknown> = {
    eq: () => handler, gte: () => handler, lte: () => handler, not: () => handler,
    order: () => handler, limit: () => handler,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return handler
}

const mockLeads = [
  { id: 'l1', lead_stage: 'NEW', ai_score: 50, estimated_revenue: 100_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 0, next_follow_up_at: null, event_type: 'wedding', source: 'website' },
  { id: 'l2', lead_stage: 'CONFIRMED', ai_score: 90, estimated_revenue: 200_000, assigned_to: null, created_at: recentISO, last_contacted_at: null, follow_up_count: 1, next_follow_up_at: null, event_type: 'wedding', source: 'referral' },
]

function tableResult(result: { data?: unknown; error?: unknown; count?: number }) {
  return { select: () => makeQueryResult(result) }
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      switch (table) {
        case 'leads': return {
          // Simulates migration 026 not being live: the core leads columns
          // succeed (no error), but the campaign/utm_source/utm_medium-only
          // query fails with a real Postgres "column does not exist" style
          // error.
          select: (cols?: string) => {
            if (cols && cols.startsWith('id, campaign')) {
              return makeQueryResult({ data: null, error: { message: 'column leads.campaign does not exist' } })
            }
            return makeQueryResult({ data: mockLeads, error: null })
          },
        }
        case 'proposals': return tableResult({ data: [], error: null })
        case 'reservations': return tableResult({ data: [], error: null })
        case 'stage_transitions': return tableResult({ data: [], error: null })
        case 'inventory_items': return tableResult({ data: null, error: null, count: 0 })
        case 'message_queue': return tableResult({ data: [], error: null })
        case 'broadcast_campaigns': return tableResult({ data: [], error: null })
        case 'ai_interaction_log': return tableResult({ data: [], error: null })
        case 'follow_ups': return tableResult({ data: null, error: null, count: 0 })
        default: throw new Error(`unexpected table in revenue-intelligence campaign-degraded test: ${table}`)
      }
    },
  }),
}))

import { buildRevenueIntelligence } from './revenue-intelligence'

describe('buildRevenueIntelligence — campaign attribution degrades gracefully when migration 026 is not live', () => {
  it('does not lose any leads, funnel, or channel data when the campaign-only query errors', async () => {
    const result = await buildRevenueIntelligence(90)

    // The core leads array must be fully intact — this is the exact
    // regression this design avoids (a single combined query would have
    // returned zero leads here instead).
    expect(result.funnel.stages.find((s) => s.stage === 'Lead')!.count).toBe(2)
    expect(result.channelPerformance.find((c) => c.key === 'website')?.leads).toBe(1)
    expect(result.channelPerformance.find((c) => c.key === 'referral')?.leads).toBe(1)
  })

  it('reports campaignPerformance as degraded instead of fabricating a per-campaign breakdown', async () => {
    const result = await buildRevenueIntelligence(90)
    expect(result.campaignPerformance.degraded).toBe(true)
    expect(result.campaignPerformance.rows).toHaveLength(1)
    expect(result.campaignPerformance.rows[0].key).toMatch(/Attribution Unavailable/)
    expect(result.campaignPerformance.rows[0].leads).toBe(2)
  })

  it('surfaces the degraded state in the AI Marketing Brief\'s budget recommendation rather than silently guessing', async () => {
    const result = await buildRevenueIntelligence(90)
    expect(result.marketingBrief.budgetRecommendation).toMatch(/migration 026/i)
  })
})
