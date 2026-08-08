import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/metrics-service.test.ts
// Sprint 4 (Marketing Intelligence) — first test coverage for this file.
// Covers getTopPerformingContent() and computeBestPostingTime(); does not
// re-test getEngagementSummary()/syncPostMetrics() (unchanged, untested
// before this sprint, out of scope for this pass).
// ─────────────────────────────────────────────────────────────────────────────

interface MetricRow {
  post_id: string
  reach: number | null
  impressions: number | null
  clicks: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  social_posts: { platform: string; content: string | null; published_at: string | null; status: string }
}

const state = {
  rows: [] as MetricRow[],
  error: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_post_metrics') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          limit: () => Promise.resolve({ data: state.error ? null : state.rows, error: state.error }),
        }),
      }
    },
  }),
}))

vi.mock('@/lib/social/adapter-registry', () => ({ getSocialAdapter: () => null }))

import { getTopPerformingContent, computeBestPostingTime } from './metrics-service'

function row(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    post_id: 'post-1',
    reach: 100,
    impressions: 200,
    clicks: 5,
    likes: 10,
    comments: 2,
    shares: 1,
    saves: 0,
    social_posts: { platform: 'instagram', content: 'A post', published_at: '2026-08-01T10:00:00.000Z', status: 'published' },
    ...overrides,
  }
}

beforeEach(() => {
  state.rows = []
  state.error = null
})

describe('getTopPerformingContent', () => {
  it('ranks posts by engagementScore (likes + comments*2 + shares*3 + saves*2), highest first', async () => {
    state.rows = [
      row({ post_id: 'low', likes: 5, comments: 0, shares: 0, saves: 0 }), // score 5
      row({ post_id: 'high', likes: 1, comments: 0, shares: 5, saves: 0 }), // score 1 + 0*2 + 5*3 + 0*2 = 16
    ]
    const result = await getTopPerformingContent(10)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.map((r) => r.postId)).toEqual(['high', 'low'])
      expect(result.value[0].engagementScore).toBe(16)
    }
  })

  it('excludes non-published posts', async () => {
    state.rows = [row({ post_id: 'draft-post', social_posts: { platform: 'facebook', content: 'x', published_at: null, status: 'draft' } })]
    const result = await getTopPerformingContent(10)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(0)
  })

  it('respects the limit parameter', async () => {
    state.rows = [row({ post_id: 'a' }), row({ post_id: 'b' }), row({ post_id: 'c' })]
    const result = await getTopPerformingContent(2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(2)
  })

  it('propagates a query error', async () => {
    state.error = { message: 'db down' }
    const result = await getTopPerformingContent(10)
    expect(result).toEqual({ ok: false, error: 'db down' })
  })
})

describe('computeBestPostingTime', () => {
  it('returns an honest "insufficient data" recommendation below the minimum sample size', async () => {
    state.rows = [row(), row({ post_id: 'p2' })] // only 2, minimum is 5
    const result = await computeBestPostingTime()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sampleSize).toBe(2)
      expect(result.value.byHour).toEqual([])
      expect(result.value.recommendation).toMatch(/Insufficient data/)
    }
  })

  it('aggregates by hour and day-of-week once the minimum sample is met', async () => {
    // 5 posts, all published at 10:00 UTC on a Saturday (2026-08-01 is a Saturday).
    state.rows = Array.from({ length: 5 }, (_, i) =>
      row({ post_id: `p${i}`, likes: 10, comments: 0, shares: 0, saves: 0, social_posts: { platform: 'instagram', content: 'x', published_at: '2026-08-01T10:00:00.000Z', status: 'published' } })
    )
    const result = await computeBestPostingTime()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sampleSize).toBe(5)
      expect(result.value.byHour.length).toBeGreaterThan(0)
      expect(result.value.byDayOfWeek.length).toBeGreaterThan(0)
      expect(result.value.recommendation).toMatch(/Based on 5 published posts/)
    }
  })

  it('propagates a query error', async () => {
    state.error = { message: 'db down' }
    const result = await computeBestPostingTime()
    expect(result).toEqual({ ok: false, error: 'db down' })
  })
})
