import { describe, it, expect, vi } from 'vitest'

interface EventRow {
  event_type: string
  properties: { campaign?: string | null; business_package_id?: string | null } | null
  created_at: string
}

const state = { rows: [] as EventRow[], nextError: null as { message: string } | null }

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'analytics_events') throw new Error(`unexpected table ${table}`)
      const builder: Record<string, unknown> = {}
      builder.in = () => builder
      builder.gte = () => builder
      builder.lt = () => builder
      builder.then = (resolve: (v: { data: EventRow[] | null; error: unknown }) => void) =>
        resolve(state.nextError ? { data: null, error: state.nextError } : { data: state.rows, error: null })
      return { select: () => builder }
    },
  }),
}))

import { computeClickAnalytics } from './click-analytics-service'

describe('computeClickAnalytics', () => {
  it('groups clicks by campaign and by business package, per event type', async () => {
    state.nextError = null
    state.rows = [
      { event_type: 'whatsapp_click', properties: { campaign: 'wedding-fb-ad', business_package_id: 'pkg1' }, created_at: '2026-01-01' },
      { event_type: 'whatsapp_click', properties: { campaign: 'wedding-fb-ad', business_package_id: 'pkg1' }, created_at: '2026-01-02' },
      { event_type: 'whatsapp_click', properties: { campaign: 'other-campaign', business_package_id: null }, created_at: '2026-01-03' },
      { event_type: 'call_click', properties: { campaign: null, business_package_id: 'pkg2' }, created_at: '2026-01-04' },
    ]

    const result = await computeClickAnalytics()
    const whatsapp = result.rows.find((r) => r.type === 'whatsapp_click')!
    expect(whatsapp.totalClicks).toBe(3)
    expect(whatsapp.byCampaign).toEqual([{ campaign: 'wedding-fb-ad', clicks: 2 }, { campaign: 'other-campaign', clicks: 1 }])
    // Clicks with no business_package_id on file are excluded, not bucketed under a fake key.
    expect(whatsapp.byBusinessPackage).toEqual([{ businessPackageId: 'pkg1', clicks: 2 }])

    const call = result.rows.find((r) => r.type === 'call_click')!
    expect(call.byBusinessPackage).toEqual([{ businessPackageId: 'pkg2', clicks: 1 }])

    expect(result.totalClicks).toBe(4)
  })

  it('returns a zeroed, never-fabricated result when the query fails', async () => {
    state.nextError = { message: 'db down' }
    const result = await computeClickAnalytics()
    expect(result.totalClicks).toBe(0)
    for (const row of result.rows) {
      expect(row.byCampaign).toEqual([])
      expect(row.byBusinessPackage).toEqual([])
    }
  })
})
